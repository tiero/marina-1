import { NetworkString } from 'ldk';
import { AccountID } from '../../../domain/account';
import { ActionWithPayload } from '../../../domain/common';
import { UPDATE_TASK } from './action-types';

export type UpdateTaskAction = ActionWithPayload<{ accountID: AccountID; network: NetworkString }>;

export const updateTaskAction = (
  accountID: AccountID,
  network: NetworkString
): UpdateTaskAction => ({
  type: UPDATE_TASK,
  payload: { accountID, network },
});
