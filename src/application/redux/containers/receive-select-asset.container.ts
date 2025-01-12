import { connect } from 'react-redux';
import { MainAccountID } from '../../../domain/account';
import { assetGetterFromIAssets } from '../../../domain/assets';
import { RootReducerState } from '../../../domain/common';
import ReceiveSelectAssetView, {
  ReceiveSelectAssetProps,
} from '../../../presentation/wallet/receive/receive-select-asset';
import { selectBalances } from '../selectors/balance.selector';

const mapStateToProps = (state: RootReducerState): ReceiveSelectAssetProps => {
  const balances = selectBalances(MainAccountID)(state);
  const getAsset = assetGetterFromIAssets(state.assets);
  return {
    network: state.app.network,
    assets: Object.keys(balances).map(getAsset),
  };
};

const ReceiveSelectAsset = connect(mapStateToProps)(ReceiveSelectAssetView);

export default ReceiveSelectAsset;
