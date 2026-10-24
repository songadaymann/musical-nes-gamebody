; Three independent performances share two pulse channels, one triangle and
; one noise channel. Live notes have priority, then the second recorded part.
; A square's quiet echo uses a spare pulse channel when available.
.proc load_voice
    ldx voice_index
    lda voice_offsets,x
    sta voice_offset
    tax
    ldy #0
copy:
    lda voice_states,x
    sta voice_begin,y
    inx
    iny
    cpy #VOICE_SIZE
    bne copy
    rts
.endproc

.proc save_voice
    ldx voice_index
    lda voice_offsets,x
    tax
    ldy #0
copy:
    lda voice_begin,y
    sta voice_states,x
    inx
    iny
    cpy #VOICE_SIZE
    bne copy
    rts
.endproc

.proc clear_voice_delay
    ldx voice_index
    lda delay_offsets,x
    tax
    ldy #16
    lda #0
clear:
    sta delay_notes,x
    sta delay_volumes,x
    inx
    dey
    bne clear
    rts
.endproc

.proc init_voice
    lda #0
    ldx #VOICE_SIZE-1
clear:
    sta voice_begin,x
    dex
    bpl clear
    lda #$FF
    sta direction
    sta old_note
    sta old_sound
    sta rendered_sound
    sta echo_previous
    sta triangle_pitch
    sta pulse_pitch
    lda #32
    sta voice_age
    lda #$70
    sta apu_shadow
    lda #$B0
    sta apu_shadow+4
    lda #$80
    sta apu_shadow+8
    lda #$30
    sta apu_shadow+12
    jmp clear_voice_delay
.endproc

.proc reset_all_voices
    lda #0
    sta voice_index
    sta $4015
voice:
    jsr init_voice
    jsr save_voice
    inc voice_index
    lda voice_index
    cmp #3
    bne voice
    lda #$FF
    sta old_pulse_one
    sta old_pulse_two
    sta old_triangle
    sta old_noise
    lda #$70
    sta $4000
    sta $4004
    lda #$80
    sta $4008
    lda #$30
    sta $400C
    lda #$0F
    sta $4015
    lda #0
    sta voice_index
    jmp load_voice
.endproc

.proc mix_voices
    lda #$FF
    sta pulse_one
    sta pulse_two
    sta triangle_owner
    sta noise_owner
    lda #0
    sta mix_level
    sta phase
scan:
    ldy phase
    lda voice_priority,y
    sta temp
    tax
    lda voice_offsets,x
    tax
    lda voice_states+(sound-voice_begin),x
    bne triangle
    lda voice_states+(gate-voice_begin),x
    ora voice_states+(lead_volume-voice_begin),x
    beq triangle
    lda pulse_one
    cmp #$FF
    bne second
    lda temp
    sta pulse_one
    jmp triangle
second:
    lda pulse_two
    cmp #$FF
    bne triangle
    lda temp
    sta pulse_two
triangle:
    lda triangle_owner
    cmp #$FF
    bne noise
    lda voice_states+(triangle_on-voice_begin),x
    beq noise
    lda temp
    sta triangle_owner
noise:
    lda noise_owner
    cmp #$FF
    bne next
    lda voice_states+(noise_volume-voice_begin),x
    beq next
    lda temp
    sta noise_owner
next:
    inc phase
    lda phase
    cmp #3
    bne scan
    lda pulse_two
    cmp #$FF
    bne render
    ldy #0
find_echo:
    lda voice_priority,y
    sta temp
    tax
    lda voice_offsets,x
    tax
    lda voice_states+(echo_volume-voice_begin),x
    bne echo_found
    iny
    cpy #3
    bne find_echo
    jmp render
echo_found:
    lda temp
    clc
    adc #3              ; owners 3..5 mean the corresponding echo
    ldx pulse_one
    cpx #$FF
    bne echo_second
    sta pulse_one
    jmp render
echo_second:
    sta pulse_two
render:
    lda old_pulse_one
    sta mix_previous
    lda pulse_one
    ldx #0
    jsr render_pulse
    lda pulse_one
    sta old_pulse_one
    lda old_pulse_two
    sta mix_previous
    lda pulse_two
    ldx #4
    jsr render_pulse
    lda pulse_two
    sta old_pulse_two
    jsr render_triangle
    jmp render_noise
.endproc

; X = physical channel register offset (0 or 4). A = part/echo owner.
.proc render_pulse
    sta mix_owner
    cmp #$FF
    bne audible
    lda #$70
    sta $4000,x
    rts
audible:
    lda #1
    sta mix_mask
    lda #0
    sta mix_source
    lda mix_owner
    cmp #3
    bcc source
    sec
    sbc #3
    pha
    lda #2
    sta mix_mask
    lda #4
    sta mix_source
    pla
source:
    tay
    lda voice_offsets,y
    tay
    lda voice_states+(apu_dirty-voice_begin),y
    and mix_mask
    sta temp
    tya
    clc
    adc mix_source
    tay
    lda voice_states+(apu_shadow-voice_begin),y
    sta $4000,x
    and #15
    ora mix_level
    sta mix_level
    lda voice_states+(apu_shadow-voice_begin)+2,y
    sta $4002,x
    lda mix_owner
    cmp mix_previous
    bne trigger
    lda temp
    beq done
trigger:
    lda voice_states+(apu_shadow-voice_begin)+3,y
    sta $4003,x
done:
    rts
.endproc

.proc render_triangle
    lda triangle_owner
    cmp #$FF
    bne audible
    lda #$80
    sta $4008
    jmp done
audible:
    tax
    lda voice_offsets,x
    tax
    lda #8
    ora mix_level
    sta mix_level
    lda voice_states+(apu_shadow-voice_begin)+8,x
    sta $4008
    lda voice_states+(apu_shadow-voice_begin)+10,x
    sta $400A
    lda triangle_owner
    cmp old_triangle
    bne trigger
    lda voice_states+(apu_dirty-voice_begin),x
    and #4
    beq done
trigger:
    lda voice_states+(apu_shadow-voice_begin)+11,x
    sta $400B
done:
    lda triangle_owner
    sta old_triangle
    rts
.endproc

.proc render_noise
    lda noise_owner
    cmp #$FF
    bne audible
    lda #$30
    sta $400C
    jmp done
audible:
    tax
    lda voice_offsets,x
    tax
    lda voice_states+(apu_shadow-voice_begin)+12,x
    sta $400C
    and #15
    ora mix_level
    sta mix_level
    lda voice_states+(apu_shadow-voice_begin)+14,x
    sta $400E
    lda noise_owner
    cmp old_noise
    bne trigger
    lda voice_states+(apu_dirty-voice_begin),x
    and #8
    beq done
trigger:
    lda #$08
    sta $400F
done:
    lda noise_owner
    sta old_noise
    rts
.endproc
