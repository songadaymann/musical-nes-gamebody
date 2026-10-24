; Start taps act on release; a one-second hold clears without starting a take.
.proc global_controls
    lda raw_buttons
    and #BTN_START
    beq released
    lda start_hold
    cmp #60
    bcs settings
    inc start_hold
    lda start_hold
    cmp #60
    bne settings
    jsr clear_loops
    jmp settings
released:
    lda start_hold
    beq settings
    cmp #60
    bcs no_tap
    jsr start_tap
no_tap:
    lda #0
    sta start_hold
settings:
    lda raw_buttons
    and #(BTN_A | BTN_B)
    bne latch_kept
    sta sound_latch
latch_kept:
    lda raw_pressed
    and #BTN_SELECT
    beq sound_gesture
    lda selected_octave
    clc
    adc #1
    and #3
    sta selected_octave
sound_gesture:
    lda raw_buttons
    and #(BTN_A | BTN_B)
    cmp #(BTN_A | BTN_B)
    bne done
    lda sound_latch
    bne done
    lda #1
    sta sound_latch
    ; At rest select a patch; during notes A+B remains an upper-bank burst.
    lda raw_buttons
    and #$0F
    bne done
    inc selected_sound
    lda selected_sound
    cmp #SOUND_COUNT
    bcc done
    lda #0
    sta selected_sound
done:
    rts
.endproc

.proc start_tap
    lda loop_state
    beq arm
    cmp #1
    beq cancel
    cmp #2
    beq close_first
    cmp #4
    beq close_second
    ; Replace only the second part, keeping the first loop and its phase.
    lda #$FF
    ldx #0
erase_second:
    sta loop_second,x
    sta loop_second+256,x
    inx
    bne erase_second
    lda #0
    sta layer_present
    lda loop_length
    sta dub_remaining
    lda loop_length+1
    sta dub_remaining+1
    lda #4
    sta loop_state
    rts
arm:
    lda #1
    sta loop_state
    rts
cancel:
    lda #0
    sta loop_state
    rts
close_first:
    lda #0
    sta loop_position
    sta loop_position+1
    jmp playback
close_second:
    lda #1
    sta layer_present
playback:
    lda #3
    sta loop_state
    lda #1
    sta live_muted       ; don't double a note held across the closing tap
    rts
.endproc

.proc clear_loops
    lda #0
    sta loop_state
    sta loop_position
    sta loop_position+1
    sta loop_length
    sta loop_length+1
    sta dub_remaining
    sta dub_remaining+1
    sta layer_present
    lda #1
    sta live_muted
    jmp reset_all_voices
.endproc

.proc perform_frame
    lda #0
    sta loop_started
    sta voice_index
    jsr load_voice
    lda live_muted
    beq keep_live
    jsr init_voice
keep_live:
    lda buttons
    sta previous
    lda raw_buttons
    and #$0F
    bne held
    lda #0
    sta live_muted
held:
    lda raw_buttons
    and #$CF
    ldx live_muted
    beq unmuted
    lda #0
unmuted:
    sta buttons
    lda selected_octave
    sta base_octave
    lda selected_sound
    sta sound
    jsr performance_edges
    jsr choose_note
    jsr encode_note
    jsr record_live
    jsr play_sound
    jsr save_voice
    lda #1
    sta voice_index
    jsr perform_loop
    lda #2
    sta voice_index
    jsr perform_loop
    jsr mix_voices
    lda loop_state
    cmp #3
    bcc restore_live
    lda loop_started
    cmp #1
    beq restore_live     ; full first take starts playback next frame
    jsr next_position
    lda loop_position
    cmp loop_length
    bne finish_dub
    lda loop_position+1
    cmp loop_length+1
    bne finish_dub
    lda #0
    sta loop_position
    sta loop_position+1
finish_dub:
    lda loop_started
    cmp #2
    bne restore_live
    lda #3
    sta loop_state
    lda #1
    sta layer_present
    sta live_muted
restore_live:
    lda #0
    sta voice_index
    jmp load_voice
.endproc

.proc record_live
    lda loop_state
    cmp #1
    bne state
    lda gate
    beq done
    lda #2
    sta loop_state
state:
    lda loop_state
    cmp #2
    beq first
    cmp #4
    bne done
    lda #>loop_second
    jsr buffer_address
    lda encoded_note
    sta (ptr),y
    lda dub_remaining
    bne decrement
    dec dub_remaining+1
decrement:
    dec dub_remaining
    lda dub_remaining
    ora dub_remaining+1
    bne done
    lda #2
    sta loop_started     ; finish after this frame has sounded live
    rts
first:
    lda #>loop_first
    jsr buffer_address
    lda encoded_note
    sta (ptr),y
    jsr next_position
    lda loop_position
    sta loop_length
    lda loop_position+1
    sta loop_length+1
    cmp #2
    bne done
    lda #3
    sta loop_state
    lda #0
    sta loop_position
    sta loop_position+1
    lda #1
    sta live_muted
    sta loop_started
done:
    rts
.endproc

.proc perform_loop
    jsr load_voice
    lda loop_state
    cmp #3
    bcc silent
    lda loop_started
    cmp #1
    beq silent
    lda voice_index
    cmp #1
    beq active
    lda loop_state
    cmp #4
    beq silent           ; the live voice sounds the part being recorded
    lda layer_present
    beq silent
active:
    lda loop_position
    ora loop_position+1
    bne read
    jsr init_voice       ; each repetition begins with a clean attack
read:
    lda #>loop_first
    ldx voice_index
    cpx #1
    beq address
    lda #>loop_second
address:
    jsr buffer_address
    lda (ptr),y
    jsr decode_note
    jsr performance_edges
    jsr choose_note
    jsr play_sound
    jmp save_voice
silent:
    jsr init_voice
    jmp save_voice
.endproc

; One byte per frame: B / patch (2 bits) / resolved note (5 bits).
; $FF is rest. Resolve diagonals before packing to preserve the played note.
.proc encode_note
    lda #$FF
    ldx gate
    beq done
    lda sound
    asl a
    asl a
    asl a
    asl a
    asl a
    ora note_id
    sta encoded_note
    lda buttons
    and #BTN_B
    asl a
    ora encoded_note
done:
    sta encoded_note
    rts
.endproc

.proc decode_note
    sta encoded_note
    lda buttons
    sta previous
    lda encoded_note
    cmp #$FF
    bne note
    lda #0
    sta buttons
    rts
note:
    and #31
    pha
    lsr a
    lsr a
    lsr a
    sta base_octave
    pla
    and #7
    pha
    and #3
    tax
    lda direction_bits,x
    sta buttons
    pla
    and #4
    beq lower
    lda buttons
    ora #BTN_A
    sta buttons
lower:
    lda encoded_note
    bpl plain
    lda buttons
    ora #BTN_B
    sta buttons
plain:
    lda encoded_note
    lsr a
    lsr a
    lsr a
    lsr a
    lsr a
    and #3
    sta sound
    rts
.endproc

.proc performance_edges
    lda previous
    eor #$FF
    and buttons
    sta pressed
    rts
.endproc

; A = high byte of a page-aligned 512-byte take buffer.
.proc buffer_address
    clc
    adc loop_position+1
    sta ptr+1
    lda #0
    sta ptr
    ldy loop_position
    rts
.endproc

.proc next_position
    inc loop_position
    bne done
    inc loop_position+1
done:
    rts
.endproc
