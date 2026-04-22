// Conformance map: which olcbchecker check scripts run in which harness mode.
//
// Sourced from OlcbCheckerClone/control_master.py:
//   - checkAllNoTrains() → frame, message, SNIP, events, datagram, memory,
//                          CDI, stream
//   - checkAll()         → adds traincontrol, trainsearch, FDI,
//                          broadcasttime, dccdetector
//
// Our harness splits broadcasttime into producer- and consumer-specific
// sets (mirrors control_broadcasttime.py's runtime prompt).
//
// DCC-detector (dd*) checks run only in the dedicated `detector` mode,
// which registers detector-format producer events on the node. Other modes
// advertise Event Exchange in PIP but do not emit detector events, so the
// dd* checks would fail there (they require at least one detector event).

// ---- Common base — every mode runs these --------------------------------

const FRAME = [
    'check_fr10_init.py',
    'check_fr20_ame.py',
    'check_fr30_collide.py',
    'check_fr40_highbit.py',
    'check_fr50_capacity.py',
    'check_fr60_standard.py',
];

const MESSAGE = [
    'check_me10_init.py',
    'check_me20_verify.py',
    'check_me30_pip.py',
    'check_me40_oir.py',
    'check_me50_dup.py',
    'check_me60_pip_simple.py',
];

const SNIP = [
    'check_sn10_snip.py',
];

const EVENTS = [
    'check_ev10_ida.py',
    'check_ev20_idg.py',
    'check_ev30_ip.py',
    'check_ev40_ic.py',
    'check_ev50_ini.py',
    'check_ev60_ewp.py',
    'check_ev70_lrn.py',
];

const DATAGRAM = [
    'check_da30_dr.py',
    'check_da40_unknown_protocol.py',
];

const MEMORY = [
    'check_mc10_co.py',
    'check_mc20_ckasi.py',
    'check_mc30_read.py',
    'check_mc40_lock.py',
    'check_mc50_restart.py',
    'check_mc60_out_of_range.py',
    'check_mc70_write_under_mask.py',
    'check_mc80_write.py',
];

const CDI = [
    'check_cd10_valid.py',
    'check_cd20_read.py',
    'check_cd30_acdi.py',
    'check_cd40_acdi_writeback.py',
];

const STREAM = [
    'check_st10_initiate.py',
    'check_st20_reject_unsupported.py',
    'check_st30_buffer_negotiation.py',
    'check_st35_min_buffer.py',
    'check_st37_max_buffer.py',
    'check_st40_unknown_content_uid.py',
    'check_st50_initiate_reply_format.py',
    'check_st60_data_send.py',
    'check_st65_data_proceed_flow.py',
    'check_st70_complete.py',
    'check_st80_terminate_error.py',
    'check_st85_stability.py',
    'check_st90_oir_fallback.py',
    'check_st100_concurrent_same_node.py',
    'check_st110_concurrent_multi_node.py',
    'check_st120_sustained_transfer.py',
    'check_st130_min_chunk_send.py',
    'check_st140_concurrent_sustained.py',
    'check_st150_asymmetric_buffers.py',
    'check_st155_negotiation_enforcement.py',
    'check_st170_zero_payload_flush.py',
    'check_st180_interleaved_data_send.py',
    'check_st190_suggested_did.py',
    'check_st200_complete_with_byte_count.py',
    'check_st210_reject_then_retry.py',
];

const DCC_DETECTOR = [
    'check_dd10_identify.py',
    'check_dd20_event_format.py',
    'check_dd30_identify_producer.py',
    'check_dd40_track_empty.py',
];

const COMMON = [
    ...FRAME, ...MESSAGE, ...SNIP, ...EVENTS, ...DATAGRAM,
    ...MEMORY, ...CDI, ...STREAM,
];

// ---- Mode-specific additions -------------------------------------------

const TRAIN_CONTROL = [
    'check_tr010_events.py',
    'check_tr020_speed.py',
    'check_tr030_func.py',
    'check_tr040_estop.py',
    'check_tr050_gestop.py',
    'check_tr060_geoff.py',
    'check_tr070_memspaces.py',
    'check_tr080_listener.py',
    'check_tr090_controller.py',
    'check_tr100_reserve.py',
    'check_tr110_heartbeat.py',
];

const TRAIN_SEARCH = [
    'check_ts10_create.py',
    'check_ts20_partial.py',
    'check_ts30_reserved2.py',
    'check_ts40_reserved4.py',
];

const FDI = [
    'check_fd10_valid.py',
    'check_fd20_read.py',
    'check_fd30_readonly.py',
];

const BT_PRODUCER = [
    'check_bt10_query.py',
    'check_bt20_set.py',
    'check_bt30_immediate.py',
    'check_bt40_multiset.py',
    'check_bt50_freq.py',
    'check_bt60_requested.py',
    'check_bt70_rollover.py',
    'check_bt80_startup.py',
];

const BT_CONSUMER = [
    'check_bt100_consumer_startup.py',
    'check_bt110_consumer_sync.py',
    'check_bt120_consumer_startstop.py',
    'check_bt130_consumer_rate.py',
];

// ---- Final map ---------------------------------------------------------

export const MODE_CHECKS = {
    'basic':                    [...COMMON],
    'train':                    [...COMMON, ...TRAIN_CONTROL, ...TRAIN_SEARCH, ...FDI],
    'broadcast-time-producer':  [...COMMON, ...BT_PRODUCER],
    'broadcast-time-consumer':  [...COMMON, ...BT_CONSUMER],
    'detector':                 [...COMMON, ...DCC_DETECTOR],
};

export const ALL_MODES = Object.keys(MODE_CHECKS);
