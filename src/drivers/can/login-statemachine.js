// Ported from OpenLcbCLib/src/drivers/canbus/can_login_statemachine.[hc].
//
// Thin dispatcher that maps node.state.runState to one of the ten state
// handler methods on a CanLoginMessageHandler instance. Separating the
// dispatcher from the handlers makes the state table easy to grep and
// matches the C file split 1:1.

import {
    RUNSTATE_INIT,
    RUNSTATE_GENERATE_SEED,
    RUNSTATE_GENERATE_ALIAS,
    RUNSTATE_LOAD_CHECK_ID_07,
    RUNSTATE_LOAD_CHECK_ID_06,
    RUNSTATE_LOAD_CHECK_ID_05,
    RUNSTATE_LOAD_CHECK_ID_04,
    RUNSTATE_WAIT_200ms,
    RUNSTATE_LOAD_RESERVE_ID,
    RUNSTATE_LOAD_ALIAS_MAP_DEFINITION,
} from '../../openlcb/defines.js';

export class CanLoginStatemachine {
    /**
     * @param {CanLoginMessageHandler} handler required
     */
    constructor(handler) {
        this._handler = handler;
    }

    /** Run exactly one state for the node in `stateInfo`. Non-blocking. */
    run(stateInfo) {
        switch (stateInfo.node.state.runState) {
            case RUNSTATE_INIT:                      return this._handler.stateInit(stateInfo);
            case RUNSTATE_GENERATE_SEED:             return this._handler.stateGenerateSeed(stateInfo);
            case RUNSTATE_GENERATE_ALIAS:            return this._handler.stateGenerateAlias(stateInfo);
            case RUNSTATE_LOAD_CHECK_ID_07:          return this._handler.stateLoadCid07(stateInfo);
            case RUNSTATE_LOAD_CHECK_ID_06:          return this._handler.stateLoadCid06(stateInfo);
            case RUNSTATE_LOAD_CHECK_ID_05:          return this._handler.stateLoadCid05(stateInfo);
            case RUNSTATE_LOAD_CHECK_ID_04:          return this._handler.stateLoadCid04(stateInfo);
            case RUNSTATE_WAIT_200ms:                return this._handler.stateWait200ms(stateInfo);
            case RUNSTATE_LOAD_RESERVE_ID:           return this._handler.stateLoadRid(stateInfo);
            case RUNSTATE_LOAD_ALIAS_MAP_DEFINITION: return this._handler.stateLoadAmd(stateInfo);
            default:                                 return;
        }
    }
}
