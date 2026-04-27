// WASM ABI binding — single source of truth for cwrap signatures and
// callback hook wiring.
//
// Two exports:
//   - createHooks(dispatcher) — object to pass to the Emscripten factory.
//     The factory hands these as Module.onX, so they must be set BEFORE
//     the factory promise resolves.  Each hook routes into the dispatcher
//     which owns the per-node callback map.
//   - createApi(Module) — wraps every WASM export with Module.cwrap and
//     returns a flat object of JS-callable functions.
//
// The runtime owns node-ID → OpenLcbNode mapping and provides the
// dispatcher to this module.

// ---------------------------------------------------------------------------
// Hook wiring — C → JS
// ---------------------------------------------------------------------------

/**
 * Build the `Module.onX` hook object.  All hooks receive a node ID (for
 * node-scoped callbacks) or raw values, and delegate to `dispatcher` to
 * find the OpenLcbNode and invoke the user-supplied callback.
 *
 * @param {object} dispatcher
 * @param {(nid: bigint) => (import('../node.js').OpenLcbNode | null)} dispatcher.nodeOf
 * @param {(frame: string) => void} dispatcher.onGridconnectTx
 * @param {() => void} dispatcher.on100msTimer
 * @param {(node, addr: number, count: number, heapPtr: number) => number} dispatcher.onConfigMemRead
 * @param {(node, addr: number, count: number, heapPtr: number) => number} dispatcher.onConfigMemWrite
 */
export function createHooks(dispatcher) {
    const dispatch = (nid, cbName, ...args) => {
        const node = dispatcher.nodeOf(nid);
        if (!node) return;
        const cb = node._callbacks?.[cbName];
        if (cb) cb(node, ...args);
    };

    // Dispatch that needs to return a value (bool / number).  Returns the
    // fallback when no callback is set or the node is unknown.
    const dispatchReturn = (nid, cbName, fallback, ...args) => {
        const node = dispatcher.nodeOf(nid);
        if (!node) return fallback;
        const cb = node._callbacks?.[cbName];
        return cb ? cb(node, ...args) : fallback;
    };

    return {
        // Transport — frames out to JS.
        onGridconnectTx: (frame) => dispatcher.onGridconnectTx(frame),

        // Periodic — runtime-level, not node-scoped.
        on100msTimer: () => dispatcher.on100msTimer(),

        // Event / identification
        onLoginComplete:              (nid)                  => dispatcher.onLoginComplete(nid),
        onPcEventReport:              (nid, eid)             => dispatch(nid, 'onPcEventReport', BigInt(eid)),
        onPcEventReportWithPayload:   (nid, eid, cnt, ptr)   => dispatch(nid, 'onPcEventReportWithPayload', BigInt(eid), cnt, ptr),
        onConsumedEventPcer:          (nid, idx, eid)        => dispatch(nid, 'onConsumedEventPcer', idx, BigInt(eid)),
        onConsumedEventIdentified:    (nid, idx, eid, st)    => dispatch(nid, 'onConsumedEventIdentified', idx, BigInt(eid), st),

        onProducerIdentifiedSet:      (nid, eid) => dispatch(nid, 'onProducerIdentifiedSet',      BigInt(eid)),
        onProducerIdentifiedClear:    (nid, eid) => dispatch(nid, 'onProducerIdentifiedClear',    BigInt(eid)),
        onProducerIdentifiedUnknown:  (nid, eid) => dispatch(nid, 'onProducerIdentifiedUnknown',  BigInt(eid)),
        onProducerIdentifiedReserved: (nid, eid) => dispatch(nid, 'onProducerIdentifiedReserved', BigInt(eid)),
        onConsumerIdentifiedSet:      (nid, eid) => dispatch(nid, 'onConsumerIdentifiedSet',      BigInt(eid)),
        onConsumerIdentifiedClear:    (nid, eid) => dispatch(nid, 'onConsumerIdentifiedClear',    BigInt(eid)),
        onConsumerIdentifiedUnknown:  (nid, eid) => dispatch(nid, 'onConsumerIdentifiedUnknown',  BigInt(eid)),
        onConsumerIdentifiedReserved: (nid, eid) => dispatch(nid, 'onConsumerIdentifiedReserved', BigInt(eid)),
        onProducerRangeIdentified:    (nid, eid) => dispatch(nid, 'onProducerRangeIdentified',    BigInt(eid)),
        onConsumerRangeIdentified:    (nid, eid) => dispatch(nid, 'onConsumerRangeIdentified',    BigInt(eid)),
        onEventLearn:                 (nid, eid) => dispatch(nid, 'onEventLearn',                 BigInt(eid)),

        // Error + rejection
        onOptionalInteractionRejected: (nid, src, ec, rejMti) => dispatch(nid, 'onOptionalInteractionRejected', BigInt(src), ec, rejMti),
        onTerminateDueToError:         (nid, src, ec, rejMti) => dispatch(nid, 'onTerminateDueToError',         BigInt(src), ec, rejMti),

        // Verified Node ID reply received from a remote node — runtime-level
        // because the receiving "for-which-node" semantics aren't tied to a
        // specific local node's callback bag (any of our nodes might have
        // asked).  Routes through dispatcher.onVerifiedNodeId.
        onVerifiedNodeId:              (nid, sourceId, sourceAlias) => dispatcher.onVerifiedNodeId(BigInt(nid), BigInt(sourceId), sourceAlias),

        // Train state (local — our node IS a train)
        onTrainSpeedChanged:       (nid, speed)     => dispatch(nid, 'onTrainSpeedChanged', speed),
        onTrainFunctionChanged:    (nid, addr, val) => dispatch(nid, 'onTrainFunctionChanged', addr, val),
        onTrainEmergencyEntered:   (nid, type)      => dispatch(nid, 'onTrainEmergencyEntered', type),
        onTrainEmergencyExited:    (nid, type)      => dispatch(nid, 'onTrainEmergencyExited', type),
        onTrainControllerAssigned: (nid, ctrl)      => dispatch(nid, 'onTrainControllerAssigned', BigInt(ctrl)),
        onTrainControllerReleased: (nid)            => dispatch(nid, 'onTrainControllerReleased'),
        onTrainListenerChanged:    (nid)            => dispatch(nid, 'onTrainListenerChanged'),
        onTrainHeartbeatTimeout:   (nid)            => dispatch(nid, 'onTrainHeartbeatTimeout'),
        onTrainHeartbeatRequest:   (nid, timeoutS)  => dispatch(nid, 'onTrainHeartbeatRequest', timeoutS),
        onTrainControllerAssignRequest:  (nid, cur, req) => dispatchReturn(nid, 'onTrainControllerAssignRequest',  true, BigInt(cur), BigInt(req)),
        onTrainControllerChangedRequest: (nid, nc)       => dispatchReturn(nid, 'onTrainControllerChangedRequest', true, BigInt(nc)),

        // Train replies (throttle observes)
        onTrainQuerySpeedsReply:             (nid, set, st, cmd, act) => dispatch(nid, 'onTrainQuerySpeedsReply', set, st, cmd, act),
        onTrainQueryFunctionReply:           (nid, addr, val)         => dispatch(nid, 'onTrainQueryFunctionReply', addr, val),
        onTrainControllerAssignReply:        (nid, res, cur)          => dispatch(nid, 'onTrainControllerAssignReply', res, BigInt(cur)),
        onTrainControllerQueryReply:         (nid, fl,  cur)          => dispatch(nid, 'onTrainControllerQueryReply',  fl,  BigInt(cur)),
        onTrainControllerChangedNotifyReply: (nid, res)               => dispatch(nid, 'onTrainControllerChangedNotifyReply', res),
        onTrainReserveReply:                 (nid, res)               => dispatch(nid, 'onTrainReserveReply', res),
        onTrainListenerAttachReply:          (nid, lid, res)          => dispatch(nid, 'onTrainListenerAttachReply', BigInt(lid), res),
        onTrainListenerDetachReply:          (nid, lid, res)          => dispatch(nid, 'onTrainListenerDetachReply', BigInt(lid), res),
        onTrainListenerQueryReply:           (nid, count, idx, flags, lid) => dispatch(nid, 'onTrainListenerQueryReply', count, idx, flags, BigInt(lid)),
        onTrainSearchMatched:                (nid, eid)               => dispatch(nid, 'onTrainSearchMatched', BigInt(eid)),
        // Train-search no-match (allocate-on-search) — runtime-level because
        // no node exists yet; routes to opts.callbacks.onTrainSearchNoMatch.
        // JS returns a BigInt node ID (node already created) or null.
        onTrainSearchNoMatch:                (eid)                    => dispatcher.onTrainSearchNoMatch(BigInt(eid)),
        // Throttle-side: a remote train replied to a search this device
        // sent.  Carries source 48-bit ID + 12-bit alias.  Runtime-level
        // because the C callback isn't scoped to a particular throttle
        // node — replies go to whatever throttle is interested.
        onTrainSearchReply:                  (sourceId, sourceAlias, eid) => dispatcher.onTrainSearchReply(BigInt(sourceId), sourceAlias, BigInt(eid)),

        // Broadcast time
        onBroadcastTimeChanged:     (clockId, hour, minute) => dispatcher.onBroadcastTimeChanged(BigInt(clockId), hour, minute),
        onBroadcastTimeReceived:    (nid, clockId, a, b)    => dispatch(nid, 'onBroadcastTimeReceived', BigInt(clockId), a, b),
        onBroadcastDateReceived:    (nid, clockId, a, b)    => dispatch(nid, 'onBroadcastDateReceived', BigInt(clockId), a, b),
        onBroadcastYearReceived:    (nid, clockId, v)       => dispatch(nid, 'onBroadcastYearReceived', BigInt(clockId), v),
        onBroadcastRateReceived:    (nid, clockId, v)       => dispatch(nid, 'onBroadcastRateReceived', BigInt(clockId), v),
        onBroadcastClockStarted:    (nid, clockId)          => dispatch(nid, 'onBroadcastClockStarted', BigInt(clockId)),
        onBroadcastClockStopped:    (nid, clockId)          => dispatch(nid, 'onBroadcastClockStopped', BigInt(clockId)),
        onBroadcastDateRollover:    (nid, clockId)          => dispatch(nid, 'onBroadcastDateRollover', BigInt(clockId)),

        // Streams (observe-only)
        onStreamInitiateRequest: (statePtr) => dispatcher.onStreamInitiateRequest(statePtr),
        onStreamInitiateReply:   (statePtr) => dispatcher.onStreamInitiateReply(statePtr),
        onStreamDataReceived:    (statePtr) => dispatcher.onStreamDataReceived(statePtr),
        onStreamDataProceed:     (statePtr) => dispatcher.onStreamDataProceed(statePtr),
        onStreamComplete:        (statePtr) => dispatcher.onStreamComplete(statePtr),

        // Config memory — runtime delegates to per-node callback
        onConfigMemRead:  (nid, addr, count, ptr) => dispatcher.onConfigMemRead(nid, addr, count, ptr),
        onConfigMemWrite: (nid, addr, count, ptr) => dispatcher.onConfigMemWrite(nid, addr, count, ptr),

        // Memory-config operations — notification-only; library has already
        // sent the datagram-OK reply by the time these fire.  The application
        // owns the action (clear storage, soft-reboot, refresh from disk).
        onReboot:         (nid) => dispatch(nid, 'onReboot'),
        onFactoryReset:   (nid) => dispatch(nid, 'onFactoryReset'),
        onUpdateComplete: (nid) => dispatch(nid, 'onUpdateComplete'),
    };
}

// ---------------------------------------------------------------------------
// cwrap table — JS → C
// ---------------------------------------------------------------------------

export function createApi(Module) {
    const c = (name, ret, args) => Module.cwrap(name, ret, args);
    return {
        // Lifecycle
        initialize: c('wasm_initialize',     null, []),
        run:        c('wasm_run',            null, []),
        tick:       c('wasm_100ms_tick',     null, []),
        rx:         c('wasm_rx_gridconnect', null, ['string']),

        // Node builder
        builderReset:            c('wasm_node_builder_reset',            null,     []),
        setSnip:                 c('wasm_node_set_snip',                 null,     ['number','string','string','string','string','number']),
        setProtocolSupport:      c('wasm_node_set_protocol_support',     null,     ['number','number']),
        setEventAutocreate:      c('wasm_node_set_event_autocreate',     null,     ['number','number']),
        setConfigurationOptions: c('wasm_node_set_configuration_options',null,     ['number','number','number','string']),
        setAddressSpace:         c('wasm_node_set_address_space',        'number', ['number','number','number','number','string']),
        setCdi:                  c('wasm_node_set_cdi',                  'number', ['number','number']),
        setFdi:                  c('wasm_node_set_fdi',                  'number', ['number','number']),
        createNode:              c('wasm_create_node',                   'number', ['bigint']),

        // Events (generic)
        sendPcer:         c('wasm_send_event_pc_report',      'number', ['bigint','bigint']),
        sendEventWithMti: c('wasm_send_event_with_mti',       'number', ['bigint','bigint','number']),
        sendTeach:        c('wasm_send_teach_event',          'number', ['bigint','bigint']),
        sendInit:         c('wasm_send_initialization_event', 'number', ['bigint']),
        sendVerifyAddressed: c('wasm_send_verify_node_id_addressed', 'number', ['bigint','number','bigint']),
        sendVerifyGlobal:    c('wasm_send_verify_node_id_global',    'number', ['bigint']),
        regCEvent:        c('wasm_register_consumer_eventid', 'number', ['bigint','bigint','number']),
        regPEvent:        c('wasm_register_producer_eventid', 'number', ['bigint','bigint','number']),
        clearCEvents:     c('wasm_clear_consumer_eventids',   'number', ['bigint']),
        clearPEvents:     c('wasm_clear_producer_eventids',   'number', ['bigint']),
        regCRange:        c('wasm_register_consumer_range',   'number', ['bigint','bigint','number']),
        regPRange:        c('wasm_register_producer_range',   'number', ['bigint','bigint','number']),
        clearCRanges:     c('wasm_clear_consumer_ranges',     'number', ['bigint']),
        clearPRanges:     c('wasm_clear_producer_ranges',     'number', ['bigint']),

        // Node-scoped queries
        isProducerAssigned:       c('wasm_util_is_producer_event_assigned',   'number', ['bigint','bigint']),
        isConsumerAssigned:       c('wasm_util_is_consumer_event_assigned',   'number', ['bigint','bigint']),
        isEventInProducerRanges:  c('wasm_util_is_event_in_producer_ranges',  'number', ['bigint','bigint']),
        isEventInConsumerRanges:  c('wasm_util_is_event_in_consumer_ranges',  'number', ['bigint','bigint']),
        generateEventRangeId:     c('wasm_util_generate_event_range_id',      'bigint', ['bigint','number']),
        aliasForNodeId:           c('wasm_util_alias_for_node_id',            'number', ['bigint']),

        // Train — throttle commands (send to remote train)
        tAssign:        c('wasm_train_send_assign_controller',  'number', ['bigint','number','bigint']),
        tRelease:       c('wasm_train_send_release_controller', 'number', ['bigint','number','bigint']),
        tEstop:         c('wasm_train_send_emergency_stop',     'number', ['bigint','number','bigint']),
        tQSpeeds:       c('wasm_train_send_query_speeds',       'number', ['bigint','number','bigint']),
        tNoop:          c('wasm_train_send_noop',               'number', ['bigint','number','bigint']),
        tSetSpeed:      c('wasm_train_send_set_speed',          'number', ['bigint','number','bigint','number']),
        tSetFunction:   c('wasm_train_send_set_function',       'number', ['bigint','number','bigint','number','number']),
        tQueryFunction: c('wasm_train_send_query_function',     'number', ['bigint','number','bigint','number']),

        // Train — per-node properties
        tSetup:    c('wasm_train_setup',           'number', ['bigint']),
        tSetDcc:   c('wasm_train_set_dcc_address', 'number', ['bigint','number','number']),
        tGetDcc:   c('wasm_train_get_dcc_address', 'number', ['bigint']),
        tIsLong:   c('wasm_train_is_long_address', 'number', ['bigint']),
        tSetSteps: c('wasm_train_set_speed_steps', 'number', ['bigint','number']),
        tGetSteps: c('wasm_train_get_speed_steps', 'number', ['bigint']),
        tSetHeartbeat: c('wasm_train_set_heartbeat_timeout', 'number', ['bigint','number']),
        tGetHeartbeat: c('wasm_train_get_heartbeat_timeout', 'number', ['bigint']),

        // Train — additional throttle senders (added in CLib bindings.c)
        tQueryController:   c('wasm_train_send_query_controller',           'number', ['bigint','number','bigint']),
        tReserve:           c('wasm_train_send_reserve',                    'number', ['bigint','number','bigint']),
        tReleaseReserve:    c('wasm_train_send_release_reserve',            'number', ['bigint','number','bigint']),
        tControllerChangingNotify: c('wasm_train_send_controller_changing_notify', 'number', ['bigint','number','bigint','bigint']),
        tListenerAttach:    c('wasm_train_send_listener_attach',            'number', ['bigint','number','bigint','bigint','number']),
        tListenerDetach:    c('wasm_train_send_listener_detach',            'number', ['bigint','number','bigint','bigint']),
        tListenerQuery:     c('wasm_train_send_listener_query',             'number', ['bigint','number','bigint','number']),
        tSendSearchMatch:   c('wasm_train_send_search_match',               'number', ['bigint','bigint']),

        // Train — read-only state introspection (added for Tranche 1b/1c)
        tGetReserved:       c('wasm_train_get_reserved_by_node_id',         'bigint', ['bigint']),
        tGetListenerCount:  c('wasm_train_get_listener_count',              'number', ['bigint']),
        tGetListenerAt:     c('wasm_train_get_listener_at',                 'number', ['bigint','number','number']),

        // Broadcast time — lifecycle + send
        btIsConsumer:       c('wasm_bt_is_consumer',           'number', ['bigint']),
        btIsProducer:       c('wasm_bt_is_producer',           'number', ['bigint']),
        btSetupConsumer:    c('wasm_bt_setup_consumer',        'number', ['bigint','bigint']),
        btSetupProducer:    c('wasm_bt_setup_producer',        'number', ['bigint','bigint']),
        btStart:            c('wasm_bt_start',                 null,     ['bigint']),
        btStop:             c('wasm_bt_stop',                  null,     ['bigint']),
        btTriggerQueryReply:c('wasm_bt_trigger_query_reply',   null,     ['bigint']),
        btTriggerSyncDelay: c('wasm_bt_trigger_sync_delay',    null,     ['bigint']),
        btReportTime:       c('wasm_bt_send_report_time',      'number', ['bigint','bigint','number','number']),
        btReportDate:       c('wasm_bt_send_report_date',      'number', ['bigint','bigint','number','number']),
        btReportYear:       c('wasm_bt_send_report_year',      'number', ['bigint','bigint','number']),
        btReportRate:       c('wasm_bt_send_report_rate',      'number', ['bigint','bigint','number']),
        btSendStart:        c('wasm_bt_send_start',            'number', ['bigint','bigint']),
        btSendStop:         c('wasm_bt_send_stop',             'number', ['bigint','bigint']),
        btSendDateRollover: c('wasm_bt_send_date_rollover',    'number', ['bigint','bigint']),
        btSendQuery:        c('wasm_bt_send_query',            'number', ['bigint','bigint']),
        btSendQueryReply:   c('wasm_bt_send_query_reply',      'number', ['bigint','bigint']),
        btSetTime:          c('wasm_bt_send_set_time',         'number', ['bigint','bigint','number','number']),
        btSetDate:          c('wasm_bt_send_set_date',         'number', ['bigint','bigint','number','number']),
        btSetYear:          c('wasm_bt_send_set_year',         'number', ['bigint','bigint','number']),
        btSetRate:          c('wasm_bt_send_set_rate',         'number', ['bigint','bigint','number']),
        btCommandStart:     c('wasm_bt_send_command_start',    'number', ['bigint','bigint']),
        btCommandStop:      c('wasm_bt_send_command_stop',     'number', ['bigint','bigint']),

        // Broadcast-time codecs (pure)
        btMakeClockId:        c('wasm_bt_make_clock_id',         'bigint', ['bigint']),
        btIsTimeEvent:        c('wasm_bt_is_time_event',         'number', ['bigint']),
        btExtractClockId:     c('wasm_bt_extract_clock_id',      'bigint', ['bigint']),
        btGetEventType:       c('wasm_bt_get_event_type',        'number', ['bigint']),
        btExtractTime:        c('wasm_bt_extract_time',          'number', ['bigint']),
        btExtractDate:        c('wasm_bt_extract_date',          'number', ['bigint']),
        btExtractYear:        c('wasm_bt_extract_year',          'number', ['bigint']),
        btExtractRate:        c('wasm_bt_extract_rate',          'number', ['bigint','number']),
        btCreateTimeEvent:    c('wasm_bt_create_time_event_id',  'bigint', ['bigint','number','number','number']),
        btCreateDateEvent:    c('wasm_bt_create_date_event_id',  'bigint', ['bigint','number','number','number']),
        btCreateYearEvent:    c('wasm_bt_create_year_event_id',  'bigint', ['bigint','number','number']),
        btCreateRateEvent:    c('wasm_bt_create_rate_event_id',  'bigint', ['bigint','number','number']),
        btCreateCommandEvent: c('wasm_bt_create_command_event_id','bigint',['bigint','number']),

        // DCC detector (pure)
        dccEncode:          c('wasm_dcc_encode_event_id',      'bigint', ['bigint','number','number']),
        dccShort:           c('wasm_dcc_make_short_address',   'number', ['number']),
        dccConsist:         c('wasm_dcc_make_consist_address', 'number', ['number']),
        dccExtractDir:      c('wasm_dcc_extract_direction',    'number', ['bigint']),
        dccExtractType:     c('wasm_dcc_extract_address_type', 'number', ['bigint']),
        dccExtractRaw:      c('wasm_dcc_extract_raw_address',  'number', ['bigint']),
        dccExtractAddr:     c('wasm_dcc_extract_dcc_address',  'number', ['bigint']),
        dccExtractDetector: c('wasm_dcc_extract_detector_id',  'bigint', ['bigint']),
        dccIsEmpty:         c('wasm_dcc_is_track_empty',       'number', ['bigint']),

        // Train search (pure)
        tsIsSearchEvent:    c('wasm_train_search_is_search_event',    'number', ['bigint']),
        tsExtractFlags:     c('wasm_train_search_extract_flags',      'number', ['bigint']),
        tsExtractDigits:    c('wasm_train_search_extract_digits',     null,     ['bigint','number']),
        tsDigitsToAddress:  c('wasm_train_search_digits_to_address',  'number', ['number']),
        tsCreateEventId:    c('wasm_train_search_create_event_id',    'bigint', ['number','number']),

        // Float16 (pure)
        f16FromFloat:          c('wasm_float16_from_float',           'number', ['number']),
        f16ToFloat:            c('wasm_float16_to_float',             'number', ['number']),
        f16Negate:             c('wasm_float16_negate',               'number', ['number']),
        f16IsNaN:              c('wasm_float16_is_nan',               'number', ['number']),
        f16IsZero:             c('wasm_float16_is_zero',              'number', ['number']),
        f16SpeedWithDirection: c('wasm_float16_speed_with_direction', 'number', ['number','number']),
        f16GetSpeed:           c('wasm_float16_get_speed',            'number', ['number']),
        f16GetDirection:       c('wasm_float16_get_direction',        'number', ['number']),

        // Raw memory access (heap views)
        malloc: (n) => Module._malloc(n),
        free:   (p) => Module._free(p),
        HEAPU8: Module.HEAPU8,
        HEAP16: Module.HEAP16,
    };
}
