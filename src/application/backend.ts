import axios from 'axios';
import SafeEventEmitter from '@metamask/safe-event-emitter';
import { browser, Runtime, Windows } from 'webextension-polyfill-ts';
import {
  address,
  AddressInterface,
  decodePset,
  fetchAndUnblindUtxos,
  greedyCoinSelector,
  IdentityInterface,
  isBlindedUtxo,
  psetToUnsignedTx,
  UtxoInterface,
  walletFromCoins,
} from 'ldk';
import Marina from './marina';
import {
  decrypt,
  explorerApiUrl,
  mnemonicWalletFromAddresses,
  toStringOutpoint,
  xpubWalletFromAddresses,
} from './utils';
import { Address, Password } from '../domain/wallet/value-objects';
import { Network } from '../domain/app/value-objects';
import { Assets, AssetsByNetwork } from '../domain/asset';
import { ConnectDataByNetwork } from '../domain/connect';
import { repos } from '../infrastructure';

const POPUP_HTML = 'popup.html';

export default class Backend {
  private emitter: SafeEventEmitter;

  constructor() {
    this.emitter = new SafeEventEmitter();
  }

  waitForEvent<T>(event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const handleEvent = (val: T) => {
        if (val instanceof Error) {
          return reject(val);
        }
        return resolve(val);
      };
      this.emitter.once(event, handleEvent);
    });
  }

  async enableSite(network: 'liquid' | 'regtest') {
    await repos.connect.updateConnectData((data: ConnectDataByNetwork) => {
      if (!data[network].enabledSites.includes(data[network].enableSitePending)) {
        data[network].enabledSites.push(data[network].enableSitePending);
        data[network].enableSitePending = '';
      }
      return data;
    });
  }

  async disableSite(network: 'liquid' | 'regtest') {
    const hostname = await getCurrentUrl();
    await repos.connect.updateConnectData((data: ConnectDataByNetwork) => {
      if (data[network].enabledSites.includes(hostname)) {
        data[network].enabledSites.splice(data[network].enabledSites.indexOf(hostname), 1);
      }
      return data;
    });
  }

  async isCurentSiteEnabled(network: 'liquid' | 'regtest') {
    const hostname = await getCurrentUrl();
    const data = await repos.connect.getConnectData();
    return data[network].enabledSites.includes(hostname);
  }

  start() {
    browser.runtime.onConnect.addListener((port: Runtime.Port) => {
      // We listen for API calls from injected Marina provider.
      // id is random identifier used as reference in the response
      // name is the name of the API method
      // params is the list of arguments from the method
      port.onMessage.addListener(
        async ({ id, name, params }: { id: string; name: string; params: any[] }) => {
          let network: 'regtest' | 'liquid';

          try {
            network = await getCurrentNetwork();
          } catch (e: any) {
            return handleError(id, e);
          }

          switch (name) {
            case Marina.prototype.getNetwork.name:
              try {
                return handleResponse(id, network);
              } catch (e: any) {
                return handleError(id, e);
              }

            case Marina.prototype.isEnabled.name:
              try {
                const isEnabled = await this.isCurentSiteEnabled(network);
                return handleResponse(id, isEnabled);
              } catch (e: any) {
                return handleError(id, e);
              }

            case Marina.prototype.enable.name:
              try {
                const hostname = await getCurrentUrl();
                await repos.connect.updateConnectData((data) => {
                  data[network].enableSitePending = hostname;
                  return data;
                });

                await showPopup(`connect/enable`);

                await this.waitForEvent(Marina.prototype.enable.name);

                return handleResponse(id);
              } catch (e: any) {
                return handleError(id, e);
              }

            case 'ENABLE_RESPONSE':
              try {
                const [accepted] = params;

                // exit early if users rejected
                if (!accepted) {
                  await repos.connect.updateConnectData((data) => {
                    data[network].enableSitePending = '';
                    return data;
                  });
                  // respond to the injecteded sript
                  this.emitter.emit(
                    Marina.prototype.enable.name,
                    new Error('User rejected the connection request')
                  );
                  // repond to the popup so it can be closed
                  return handleResponse(id);
                }

                // persist the site
                await this.enableSite(network);
                // respond to the injecteded sript
                this.emitter.emit(Marina.prototype.enable.name);
                // repond to the popup so it can be closed
                return handleResponse(id);
              } catch (e: any) {
                return handleError(id, e);
              }

            case Marina.prototype.disable.name:
              try {
                await this.disableSite(network);
                return handleResponse(id);
              } catch (e: any) {
                return handleError(id, e);
              }

            case Marina.prototype.getAddresses.name:
              try {
                if (!(await this.isCurentSiteEnabled(network))) {
                  return handleError(id, new Error('User must authorize the current website'));
                }
                const xpub = await getXpub();
                const addrs = xpub.getAddresses();
                return handleResponse(id, addrs);
              } catch (e: any) {
                return handleError(id, e);
              }

            case Marina.prototype.getNextAddress.name:
              try {
                if (!(await this.isCurentSiteEnabled(network))) {
                  return handleError(id, new Error('User must authorize the current website'));
                }
                const xpub = await getXpub();
                const nextAddress = await xpub.getNextAddress();
                await persistAddress(nextAddress);
                return handleResponse(id, nextAddress);
              } catch (e: any) {
                return handleError(id, e);
              }

            case Marina.prototype.getNextChangeAddress.name:
              try {
                if (!(await this.isCurentSiteEnabled(network))) {
                  return handleError(id, new Error('User must authorize the current website'));
                }
                const xpub = await getXpub();
                const nextChangeAddress = await xpub.getNextChangeAddress();
                await persistAddress(nextChangeAddress);
                return handleResponse(id, nextChangeAddress);
              } catch (e: any) {
                return handleError(id, e);
              }

            case Marina.prototype.signTransaction.name:
              try {
                if (!(await this.isCurentSiteEnabled(network))) {
                  return handleError(id, new Error('User must authorize the current website'));
                }
                if (!params || params.length !== 1 || params.some((p) => p === null)) {
                  return handleError(id, new Error('Missing params'));
                }
                const hostname = await getCurrentUrl();
                const [tx] = params;
                await repos.connect.updateConnectData((data) => {
                  data[network].tx = {
                    hostname: hostname,
                    pset: tx,
                  };
                  return data;
                });
                await showPopup(`connect/spend-pset`);

                const rawTx = await this.waitForEvent(Marina.prototype.signTransaction.name);

                return handleResponse(id, rawTx);
              } catch (e: any) {
                return handleError(id, e);
              }

            case 'SIGN_TRANSACTION_RESPONSE':
              try {
                const [accepted, password] = params;

                // exit early if user rejected the transaction
                if (!accepted) {
                  // Flush tx data
                  await repos.connect.updateConnectData((data) => {
                    data[network].tx = undefined;
                    return data;
                  });
                  // respond to the injected script
                  this.emitter.emit(
                    Marina.prototype.signTransaction.name,
                    new Error('User rejected the spend request')
                  );
                  // repond to the popup so it can be closed
                  return handleResponse(id);
                }

                const connectDataByNetwork = await repos.connect.getConnectData();
                const { tx } = connectDataByNetwork[network];

                if (!tx || !tx.pset) throw new Error('Transaction data are missing');

                const psetBase64 = connectDataByNetwork[network].tx!.pset as string;
                const mnemo = await getMnemonic(password);
                const signedTx = await mnemo.signPset(psetBase64);

                // respond to the injected script
                this.emitter.emit(Marina.prototype.signTransaction.name, signedTx);

                return handleResponse(id);
              } catch (e: any) {
                return handleError(id, e);
              }

            case Marina.prototype.sendTransaction.name:
              try {
                if (!(await this.isCurentSiteEnabled(network))) {
                  return handleError(id, new Error('User must authorize the current website'));
                }
                if (!params || params.length !== 3 || params.some((p) => p === null)) {
                  return handleError(id, new Error('Missing params'));
                }
                const [recipientAddress, amountInSatoshis, assetHash]: string[] = params;
                const hostname = await getCurrentUrl();
                await repos.connect.updateConnectData((data) => {
                  data[network].tx = {
                    hostname: hostname,
                    recipient: recipientAddress,
                    amount: amountInSatoshis,
                    assetHash: assetHash,
                  };
                  return data;
                });
                await showPopup(`connect/spend`);

                const txid = await this.waitForEvent(Marina.prototype.sendTransaction.name);

                return handleResponse(id, txid);
              } catch (e: any) {
                await repos.connect.updateConnectData((data) => {
                  data[network].tx = undefined;
                  return data;
                });
                return handleError(id, e);
              }

            //
            case 'SEND_TRANSACTION_RESPONSE':
              try {
                const [accepted, password] = params;

                // exit early if user rejected the transaction
                if (!accepted) {
                  // Flush tx data
                  await repos.connect.updateConnectData((data) => {
                    data[network].tx = undefined;
                    return data;
                  });
                  // respond to the injected script
                  this.emitter.emit(
                    Marina.prototype.sendTransaction.name,
                    new Error('User rejected the spend request')
                  );
                  // repond to the popup so it can be closed
                  return handleResponse(id);
                }

                const connectDataByNetwork = await repos.connect.getConnectData();
                const { tx } = connectDataByNetwork[network];

                if (!tx || !tx.amount || !tx.assetHash || !tx.recipient)
                  throw new Error('Transaction data are missing');

                const { assetHash, amount, recipient } = tx;
                const coins = await getCoins();
                const txBuilder = walletFromCoins(coins, network);
                const mnemo = await getMnemonic(password);
                const changeAddress = await mnemo.getNextChangeAddress();

                const unsignedPset = txBuilder.buildTx(
                  txBuilder.createTx(),
                  [
                    {
                      address: recipient,
                      value: Number(amount),
                      asset: assetHash,
                    },
                  ],
                  greedyCoinSelector(),
                  (): string => changeAddress.confidentialAddress,
                  true
                );

                const outputsIndexToBlind: number[] = [];
                const blindKeyMap = new Map<number, string>();
                const recipientData = address.fromConfidential(recipient);
                const recipientScript = address.toOutputScript(recipientData.unconfidentialAddress);
                psetToUnsignedTx(unsignedPset).outs.forEach((out, index) => {
                  if (out.script.length === 0) return;
                  outputsIndexToBlind.push(index);
                  if (out.script.equals(recipientScript))
                    blindKeyMap.set(index, recipientData.blindingKey.toString('hex'));
                });

                const blindedPset = await mnemo.blindPset(
                  unsignedPset,
                  outputsIndexToBlind,
                  blindKeyMap
                );
                const signedPset = await mnemo.signPset(blindedPset);

                const ptx = decodePset(signedPset);
                if (!ptx.validateSignaturesOfAllInputs()) {
                  throw new Error('Transaction contains invalid signatures');
                }

                const txHex = ptx.finalizeAllInputs().extractTransaction().toHex();

                // if we reached this point we can persist the change address
                await persistAddress(changeAddress);

                // Flush tx data
                await repos.connect.updateConnectData((data) => {
                  data[network].tx = undefined;
                  return data;
                });

                // respond to the injected script
                this.emitter.emit(Marina.prototype.sendTransaction.name, txHex);

                // repond to the popup so it can be closed
                return handleResponse(id);
              } catch (e: any) {
                return handleError(id, e);
              }

            //
            default:
              return handleError(id, new Error('Method not implemented.'));
          }
        }
      );

      //
      const handleResponse = (id: string, data?: any) => {
        port.postMessage({ id, payload: { success: true, data } });
      };

      //
      const handleError = (id: string, e: Error) => {
        console.error(e.stack);
        port.postMessage({
          id,
          payload: { success: false, error: e.message },
        });
      };
    });
  }
}

async function getCurrentUrl(): Promise<string> {
  const [currentTab] = await browser.tabs.query({ currentWindow: true, active: true });
  if (!currentTab.url) throw new Error('No active tab available');
  const url = new URL(currentTab.url);
  return url.hostname;
}

export function showPopup(path?: string): Promise<Windows.Window> {
  const options = {
    url: `${POPUP_HTML}#/${path}`,
    type: 'popup',
    height: 600,
    width: 360,
    focused: true,
    left: 100,
    top: 100,
  };
  return browser.windows.create(options as any);
}

async function getXpub(): Promise<IdentityInterface> {
  const [app, wallet] = await Promise.all([repos.app.getApp(), repos.wallet.getOrCreateWallet()]);
  return await xpubWalletFromAddresses(
    wallet.masterXPub.value,
    wallet.masterBlindingKey.value,
    wallet.confidentialAddresses,
    app.network.value
  );
}

async function persistAddress(addr: AddressInterface): Promise<void> {
  await repos.wallet.addDerivedAddress(Address.create(addr.confidentialAddress));
}

async function getMnemonic(password: string): Promise<IdentityInterface> {
  let mnemonic = '';
  const [app, wallet] = await Promise.all([repos.app.getApp(), repos.wallet.getOrCreateWallet()]);
  try {
    mnemonic = decrypt(wallet.encryptedMnemonic, Password.create(password)).value;
  } catch (e: any) {
    throw new Error('Invalid password');
  }
  return await mnemonicWalletFromAddresses(
    mnemonic,
    wallet.masterBlindingKey.value,
    wallet.confidentialAddresses,
    app.network.value
  );
}

async function getCurrentNetwork(): Promise<Network['value']> {
  const app = await repos.app.getApp();
  return app.network.value;
}

async function getCoins(): Promise<UtxoInterface[]> {
  const wallet = await repos.wallet.getOrCreateWallet();
  return Array.from(wallet.utxoMap.values());
}

export async function updateUtxos() {
  const xpub = await getXpub();
  const addrs = await xpub.getAddresses();
  const [app, wallet] = await Promise.all([repos.app.getApp(), repos.wallet.getOrCreateWallet()]);
  const newMap = new Map(wallet.utxoMap);
  // Fetch utxo(s). Return blinded utxo(s) if unblinding has been skipped
  const fetchedUtxos = await fetchAndUnblindUtxos(
    addrs,
    explorerApiUrl[app.network.value],
    // Skip fetch and unblind if utxo exists in storage
    (utxo) =>
      Array.from(wallet.utxoMap.keys()).some((outpoint) => `${utxo.txid}:${utxo.vout}` === outpoint)
  );
  if (fetchedUtxos.every((u) => isBlindedUtxo(u)) && fetchedUtxos.length === wallet.utxoMap.size)
    return;
  // Add to newMap fetched utxo(s) not present in storage
  fetchedUtxos.forEach((fetchedUtxo) => {
    const isPresent = Array.from(wallet.utxoMap.keys()).some(
      (storedUtxoOutpoint) => storedUtxoOutpoint === toStringOutpoint(fetchedUtxo)
    );
    if (!isPresent) newMap.set(toStringOutpoint(fetchedUtxo), fetchedUtxo);
  });
  // Delete from newMap utxo(s) not present in fetched utxos
  Array.from(newMap.keys()).forEach((storedUtxoOutpoint) => {
    const isPresent = fetchedUtxos.some(
      (fetchedUtxo) => storedUtxoOutpoint === toStringOutpoint(fetchedUtxo)
    );
    if (!isPresent) newMap.delete(storedUtxoOutpoint);
  });
  await repos.wallet.setUtxos(newMap);
}

export async function updateAllAssetInfos() {
  const [app, assets, wallet] = await Promise.all([
    repos.app.getApp(),
    repos.assets.getAssets(),
    repos.wallet.getOrCreateWallet(),
  ]);
  const assetsFromUtxos: Assets = await Promise.all(
    [...wallet.utxoMap.values()].map(async ({ asset }) =>
      // If asset in store don't fetch
      !((asset as string) in assets[app.network.value])
        ? (await axios.get(`${explorerApiUrl[app.network.value]}/asset/${asset}`)).data
        : undefined
    )
  ).then((assetInfos) =>
    assetInfos
      .filter((a) => a !== undefined)
      .reduce(
        (acc, { asset_id, name, ticker, precision }) => ({
          ...acc,
          [asset_id]: { name, ticker, precision },
        }),
        {} as Assets
      )
  );
  // Update stores
  if (Object.keys(assetsFromUtxos).length) {
    let assetInfosLiquid = assets.liquid;
    let assetInfosRegtest = assets.regtest;
    if (app.network.value === 'liquid') {
      assetInfosLiquid = { ...assets.liquid, ...assetsFromUtxos };
    } else {
      assetInfosRegtest = { ...assets.regtest, ...assetsFromUtxos };
    }
    const newAssets: AssetsByNetwork = { liquid: assetInfosLiquid, regtest: assetInfosRegtest };
    await repos.assets.updateAssets(() => newAssets);
  }
}
