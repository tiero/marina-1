import { connect } from 'react-redux';
import { RootReducerState } from '../../../domain/common';
import EndOfFlow, { EndOfFlowProps } from '../../../presentation/wallet/send/end-of-flow';
import { selectAllAccounts } from '../selectors/wallet.selector';
import { selectEsploraURL, selectNetwork } from '../selectors/app.selector';

const mapStateToProps = (state: RootReducerState): EndOfFlowProps => ({
  accounts: selectAllAccounts(state),
  pset: state.transaction.pset,
  explorerURL: selectEsploraURL(state),
  recipientAddress: state.transaction.sendAddress?.value,
  selectedUtxos: state.transaction.selectedUtxos ?? [],
  changeAddresses: state.transaction.changeAddresses.map((changeAddress) => changeAddress.value),
  network: selectNetwork(state),
});

const SendEndOfFlow = connect(mapStateToProps)(EndOfFlow);

export default SendEndOfFlow;
