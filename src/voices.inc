; Each part renders into its own APU register image. The mixer chooses
; which parts can use the physical channels, without resetting other parts.
.proc play_sound
    lda #0
    sta apu_dirty
    lda sound
    cmp rendered_sound
    beq dispatch
    sta rendered_sound
    lda #0
    sta lead_volume
    sta echo_volume
    sta triangle_on
    sta noise_volume
    sta delay_pos
    lda #32
    sta voice_age
    jsr clear_voice_delay
    lda #$70
    sta apu_shadow
    lda #$B0
    sta apu_shadow+4
    lda #$80
    sta apu_shadow+8
    lda #$30
    sta apu_shadow+12
    lda #$FF
    sta echo_previous
    sta triangle_pitch
    sta pulse_pitch
dispatch:
    lda sound
    beq square
    cmp #2
    beq drums
    jmp play_triangle
square:
    jmp play_square
drums:
    jmp play_drums
.endproc

.proc triangle_off
    lda #$80
    sta apu_shadow+8
    lda #0
    sta triangle_on
    sta lead_volume
    rts
.endproc

; voice_pitch: note-table index, bit 7 selects one octave higher.
.proc triangle_note
    lda #$FF
    sta apu_shadow+8
    lda voice_pitch
    cmp triangle_pitch
    bne change
    lda attack_flag
    bne change
    lda triangle_on
    bne held
change:
    lda voice_pitch
    sta triangle_pitch
    and #31
    tax
    lda voice_pitch
    bmi upper
    lda triangle_low,x
    sta apu_shadow+10
    lda triangle_high,x
    jmp timer
upper:
    lda triangle_octave_low,x
    sta apu_shadow+10
    lda triangle_octave_high,x
timer:
    ora #$08
    sta apu_shadow+11
    jsr dirty_triangle
held:
    lda #1
    sta triangle_on
    lda #8
    sta lead_volume
    rts
.endproc

.proc play_triangle
    lda #0
    sta echo_volume
    lda gate
    bne active
    jmp triangle_off
active:
    lda note_age
    cmp #$FF
    beq expression
    inc note_age
expression:
    lda note_id
    sta voice_pitch
    lda buttons
    and #BTN_B
    beq plain
    lda pressed
    and #BTN_B
    beq burst
    lda #0
    sta effect_clock
burst:
    lda effect_clock
    and #15
    tax
    inc effect_clock
    cpx #7
    beq gap
    cpx #15
    beq gap
    cpx #8
    bcc play
    lda voice_pitch
    ora #$80
    sta voice_pitch
    jmp play
plain:
play:
    jmp triangle_note
gap:
    jmp triangle_off
.endproc

.proc play_drums
    lda #0
    sta echo_volume
    lda attack_flag
    beq expression
    lda #0
    sta voice_age
expression:
    lda gate
    beq envelope
    lda buttons
    and #BTN_B
    beq envelope
    lda pressed
    and #BTN_B
    beq repeat
    lda #0
    sta voice_age
    sta effect_clock
repeat:
    lda effect_clock
    and #7
    bne next
    lda #0
    sta voice_age
next:
    inc effect_clock
envelope:
    lda voice_age
    cmp #32
    bcc hit
    lda #0
    sta noise_volume
    lda #$30
    sta apu_shadow+12
    jmp triangle_off
hit:
    inc voice_age
    ldx note_slot
    lda drum_noise_period,x
    sta apu_shadow+14
    lda drum_envelope_ptr_lo,x
    sta ptr
    lda drum_envelope_ptr_hi,x
    sta ptr+1
    ldy voice_age
    dey
    lda (ptr),y
    sta noise_volume
    ora #$30
    sta apu_shadow+12
    lda voice_age
    cmp #1
    bne body
    lda #$08
    sta apu_shadow+15
    lda apu_dirty
    ora #8
    sta apu_dirty
body:
    ldx note_slot
    lda drum_body_kind,x
    beq noise_only
    lda voice_age
    cmp #13
    bcs noise_only
    ; The kit is fixed-pitch: kick, snare, hat, tom, clap, open hat, click, zap.
    tay
    dey
    lda drum_body_kind,x
    cmp #2
    beq tom
    cmp #3
    beq zap
    lda kick_low,y
    sta apu_shadow+10
    lda kick_high,y
    jmp body_timer
tom:
    lda tom_low,y
    sta apu_shadow+10
    lda tom_high,y
    jmp body_timer
zap:
    lda zap_low,y
    sta apu_shadow+10
    lda zap_high,y
body_timer:
    ora #$08
    sta apu_shadow+11
    jsr dirty_triangle
    lda #$FF
    sta apu_shadow+8
    lda #1
    sta triangle_on
    lda #8
    ora noise_volume
    sta lead_volume
    rts
noise_only:
    jsr triangle_off
    lda noise_volume
    sta lead_volume
    rts
.endproc

.proc dirty_triangle
    lda apu_dirty
    ora #4
    sta apu_dirty
    rts
.endproc

.proc play_square
    lda note_id
    sta voice_pitch
    lda gate
    beq release
    lda note_age
    cmp #$FF
    beq envelope
    inc note_age
envelope:
    lda note_age
    cmp #16
    bcc pluck
    lda #15
pluck:
    tax
    lda pluck_envelope,x
    sta lead_volume
    lda buttons
    and #BTN_B
    beq lead
    lda pressed
    and #BTN_B
    beq burst
    lda #0
    sta effect_clock
burst:
    lda effect_clock
    and #15
    tax
    inc effect_clock
    cpx #8
    bcs upper
    lda burst_lead,x
    sta lead_volume
    jmp beat
upper:
    lda burst_octave,x
    sta lead_volume
    lda voice_pitch
    ora #$80
    sta voice_pitch
beat:
    txa
    and #7
    bne lead
    lda #1
    sta attack_flag
    jmp lead
release:
    lda pulse_pitch
    sta voice_pitch
    inc release_clock
    lda release_clock
    and #1
    bne lead
    lda lead_volume
    beq lead
    dec lead_volume
lead:
    lda lead_volume
    ora #$70
    sta apu_shadow
    lda voice_pitch
    cmp pulse_pitch
    bne pitch
    lda attack_flag
    beq delay
pitch:
    lda voice_pitch
    sta pulse_pitch
    and #31
    tax
    lda voice_pitch
    bmi octave
    lda timer_low,x
    sta apu_shadow+2
    lda timer_high,x
    jmp timer
octave:
    lda octave_low,x
    sta apu_shadow+2
    lda octave_high,x
timer:
    ora #$08
    sta apu_shadow+3
    lda apu_dirty
    ora #1
    sta apu_dirty
delay:
    ldx voice_index
    lda delay_offsets,x
    clc
    adc delay_pos
    tax
    lda delay_notes,x
    sta echo_pitch
    and #31
    sta echo_id
    lda delay_volumes,x
    lsr a
    lsr a
    sta echo_volume
    lda voice_pitch
    sta delay_notes,x
    lda lead_volume
    sta delay_volumes,x
    inc delay_pos
    lda delay_pos
    and #15
    sta delay_pos
    lda buttons
    and #BTN_B
    beq echo
    lda #0              ; keep the burst gaps clear
    sta echo_volume
echo:
    lda echo_volume
    ora #$B0
    sta apu_shadow+4
    lda echo_pitch
    cmp echo_previous
    beq done
    sta echo_previous
    ldx echo_id
    lda echo_pitch
    bmi high_echo
    lda timer_low,x
    sta apu_shadow+6
    lda timer_high,x
    jmp echo_timer
high_echo:
    lda octave_low,x
    sta apu_shadow+6
    lda octave_high,x
echo_timer:
    ora #$08
    sta apu_shadow+7
    lda apu_dirty
    ora #2
    sta apu_dirty
done:
    rts
.endproc
