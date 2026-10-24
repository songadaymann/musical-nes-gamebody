; Gamebody: a real 6502 instrument for an NTSC NES, mapper 0.
; No runtime library, sampled audio, expansion audio, or browser synthesis.
.setcpu "6502"

PPUCTRL = $2000
PPUMASK = $2001
PPUSTATUS = $2002
PPUSCROLL = $2005
PPUADDR = $2006
PPUDATA = $2007
PAD = $4016

BTN_A = $80
BTN_B = $40
BTN_SELECT = $20
BTN_START = $10

.segment "HEADER"
.byte "NES", $1A, 1, 1, 0, 0 ; 16K PRG, 8K CHR, NROM, horizontal mirroring
.byte 0, 0, 0, 0, 0, 0, 0, 0 ; iNES, NTSC, no battery or trainer

.segment "ZEROPAGE"
frame:          .res 1
last_frame:     .res 1
buttons:        .res 1
previous:       .res 1
pressed:        .res 1
direction:      .res 1 ; index in direction_bits; $FF = none
base_octave:    .res 1 ; 0..3 -> root C2..C5
note_slot:      .res 1 ; 0..7, independent of octave
note_id:        .res 1 ; 0..31 timer-table index
old_note:       .res 1
gate:           .res 1
lead_volume:    .res 1
note_age:       .res 1
release_clock:  .res 1
delay_pos:      .res 1
echo_id:        .res 1
echo_volume:    .res 1
echo_pitch:     .res 1 ; index plus bit 7 for the octave voice
echo_previous:  .res 1
effect_clock:   .res 1
ui_ready:       .res 1
ui_note:        .res 1
ui_octave:      .res 1
ui_base:        .res 1
ui_bank:        .res 1
ui_labels:      .res 4
ptr:            .res 2
temp:           .res 1
sprite_index:   .res 1
phase:          .res 1
nmi_tile:       .res 1

.segment "BSS"
delay_notes:    .res 16
delay_volumes:  .res 16

.segment "CODE"
.proc reset
    sei
    cld
    ldx #$40
    stx $4017             ; inhibit frame IRQs
    ldx #$FF
    txs
    inx
    stx PPUCTRL
    stx PPUMASK
    stx $4010             ; DMC off: controller reads cannot conflict with DMC DMA
    stx $4015
    bit PPUSTATUS
wait_first:
    bit PPUSTATUS
    bpl wait_first
    lda #0
    tax
clear_ram:
    sta $0000,x
    sta $0100,x
    sta $0200,x
    sta $0300,x
    sta $0400,x
    sta $0500,x
    sta $0600,x
    sta $0700,x
    inx
    bne clear_ram
wait_second:
    bit PPUSTATUS
    bpl wait_second

    ; Fill both physical nametables, including attributes, while rendering is off.
    lda #$20
    sta PPUADDR
    lda #0
    sta PPUADDR
    ldx #8
    ldy #0
clear_vram:
    sta PPUDATA
    iny
    bne clear_vram
    dex
    bne clear_vram

    lda #<screen
    sta ptr
    lda #>screen
    sta ptr+1
    lda #$20
    sta PPUADDR
    lda #0
    sta PPUADDR
    ldx #4
    ldy #0
copy_screen:
    lda (ptr),y
    sta PPUDATA
    iny
    bne copy_screen
    inc ptr+1
    dex
    bne copy_screen

    lda #$3F
    sta PPUADDR
    lda #0
    sta PPUADDR
    tax
palette_loop:
    lda palette,x
    sta PPUDATA
    inx
    cpx #32
    bne palette_loop

    lda #$FF
    sta direction
    sta old_note
    sta echo_previous
    ldx #0
hide_sprites:
    sta $0200,x
    inx
    bne hide_sprites

    lda #2                ; begin at C4
    sta base_octave
    lda #3                ; pulse channels only
    sta $4015
    lda #$08              ; negate, shift=0: avoid sweep overflow muting low notes
    sta $4001
    sta $4005
    lda #$70
    sta $4000
    lda #$B0
    sta $4004
    jsr prepare_ui
    jsr draw_ui
    lda #0
    sta PPUSCROLL
    sta PPUSCROLL
    lda #$80
    sta PPUCTRL           ; NMI, background and sprites use pattern table 0
    lda #$1E
    sta PPUMASK
main:
    lda frame
    cmp last_frame
    beq main
    sta last_frame
    lda #0
    sta ui_ready
    jsr read_controller
    jsr choose_note
    jsr play_sound
    jsr animate
    jsr prepare_ui
    lda #1
    sta ui_ready
    jmp main
.endproc

.proc read_controller
    lda buttons
    sta previous
    lda #1
    sta PAD
    lda #0
    sta PAD
    sta buttons
    ldx #8
read_bit:
    lda PAD
    and #1
    lsr a
    rol buttons
    dex
    bne read_bit
    lda previous
    eor #$FF
    and buttons
    sta pressed
    rts
.endproc

.proc choose_note
    ; Both octave keys together cancel; holding one never auto-repeats.
    lda buttons
    and #(BTN_SELECT | BTN_START)
    cmp #(BTN_SELECT | BTN_START)
    beq choose_direction
    lda pressed
    and #BTN_SELECT
    beq octave_up
    lda base_octave
    beq choose_direction
    dec base_octave
    jmp choose_direction
octave_up:
    lda pressed
    and #BTN_START
    beq choose_direction
    lda base_octave
    cmp #3
    bcs choose_direction
    inc base_octave
choose_direction:
    ; A new direction takes over immediately, including diagonal transitions.
    lda pressed
    and #$0F
    beq keep_direction
    ldx #3
new_direction:
    and direction_bits,x
    bne found
    lda pressed
    dex
    bpl new_direction
keep_direction:
    ldx direction
    cpx #$FF
    beq fallback
    lda buttons
    and direction_bits,x
    bne found
fallback:
    ldx #3
scan:
    lda buttons
    and direction_bits,x
    bne found
    dex
    bpl scan
    lda #$FF
    sta direction
    lda #0
    sta gate
    rts
found:
    stx direction
    txa
    sta note_slot
    lda buttons
    and #BTN_A
    beq lower_bank
    lda note_slot
    clc
    adc #4
    sta note_slot
lower_bank:
    lda base_octave
    asl a
    asl a
    asl a
    clc
    adc note_slot
    sta note_id
    cmp old_note
    bne attack
    lda gate
    bne held
attack:
    lda note_id
    sta old_note
    tax
    lda timer_low,x
    sta $4002
    lda timer_high,x
    ora #$08
    sta $4003             ; write high only on note onset/change, never every frame
    lda #12
    sta lead_volume
    lda #0
    sta note_age
    sta release_clock
    sta effect_clock
held:
    lda #1
    sta gate
    rts
.endproc

.proc play_sound
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
    lda burst_lead,x
    sta lead_volume
    cpx #0
    bne lead
    ldx note_id
    lda timer_high,x
    ora #$08
    sta $4003            ; a deliberate new attack once per rhythmic burst
    jmp lead
release:
    inc release_clock
    lda release_clock
    and #1
    bne lead
    lda lead_volume
    beq lead
    dec lead_volume
lead:
    lda lead_volume
    ora #$70             ; 25% duty pluck, constant volume, length counter halted
    sta $4000

    ; A 16-frame delayed second voice. Read before writing the ring slot.
    ldx delay_pos
    lda delay_notes,x
    sta echo_id
    lda delay_volumes,x
    lsr a
    lsr a
    sta echo_volume
    lda note_id
    sta delay_notes,x
    lda lead_volume
    sta delay_volumes,x
    inx
    txa
    and #15
    sta delay_pos

    lda echo_id
    sta echo_pitch
    lda gate
    beq echo
    lda buttons
    and #BTN_B
    beq echo
    ; B repeats a low/high pair: the lead plucks on frame 0, the octave
    ; answers on frame 8. Both voices have gaps, keeping the rhythm crisp.
    lda effect_clock
    and #15
    tax
    lda burst_octave,x
    sta echo_volume
    lda note_id
    sta echo_id
    ora #$80
    sta echo_pitch
    cpx #8
    bne next_tick
    lda #$FF
    sta echo_previous    ; retrigger the octave voice once per pair
next_tick:
    inc effect_clock
echo:
    lda echo_volume
    ora #$B0             ; 50% duty on the quieter octave/echo voice
    sta $4004
    lda echo_pitch
    cmp echo_previous
    beq done
    sta echo_previous
    ldx echo_id
    lda echo_pitch
    bmi high_octave
    lda timer_low,x
    sta $4006
    lda timer_high,x
    jmp set_high
high_octave:
    lda octave_low,x
    sta $4006
    lda octave_high,x
set_high:
    ora #$08
    sta $4007
done:
    rts
.endproc

.proc prepare_ui
    lda base_octave
    clc
    adc #'2'
    sta ui_base
    lda #0
    sta ui_bank
    lda buttons
    and #BTN_A
    beq labels
    lda #4
    sta ui_bank
labels:
    ldy ui_bank
    ldx #0
copy_labels:
    lda note_ascii,y
    sta ui_labels,x
    iny
    inx
    cpx #4
    bne copy_labels
    lda gate
    beq resting
    ldx note_slot
    lda note_glyph,x
    sta ui_note
    ldx note_id
    lda octave_ascii,x
    sta ui_octave
    rts
resting:
    lda #156
    sta ui_note
    lda #' '
    sta ui_octave
    rts
.endproc

; Only called during blanking. < 1100 cycles including NMI and DMA.
.proc draw_ui
    bit PPUSTATUS
    lda ui_note
    sta nmi_tile
    ldx #0
row:
    lda #$21
    sta PPUADDR
    lda giant_rows,x
    sta PPUADDR
    ldy #3
column:
    lda nmi_tile
    sta PPUDATA
    inc nmi_tile
    dey
    bne column
    inx
    cpx #4
    bne row
    lda #$21
    sta PPUADDR
    lda #$92             ; column 18, row 12
    sta PPUADDR
    lda ui_octave
    sta PPUDATA
    ldx #0
labels:
    lda label_hi,x
    sta PPUADDR
    lda label_lo,x
    sta PPUADDR
    lda ui_labels,x
    sta PPUDATA
    inx
    cpx #4
    bne labels
    lda #$23
    sta PPUADDR
    lda #$8F             ; base octave at column 15, row 28
    sta PPUADDR
    lda ui_base
    sta PPUDATA
    rts
.endproc

.proc animate
    ldx #0
    stx sprite_index
    lda frame
    lsr a
    sta phase
particle:
    lda lead_volume
    ora echo_volume
    beq quiet
    lda phase
    and #31
    tay
    lda wave_y,y
    clc
    adc #145
    jmp position
quiet:
    lda #145
position:
    sta $0200,x
    lda #180
    ldy buttons
    tya
    and #BTN_B
    beq dot
    lda #181
    bne tile
dot:
    lda #180
tile:
    sta $0201,x
    lda sprite_index
    and #3
    sta $0202,x
    ldy sprite_index
    lda particle_x,y
    sta $0203,x
    lda phase
    clc
    adc #4
    sta phase
    inc sprite_index
    inx
    inx
    inx
    inx
    cpx #32
    bne particle

    lda #$FF
    sta $0220
    sta $0224
    sta $0228
    ldx direction
    cpx #$FF
    beq bank_indicator
    lda highlight_y,x
    sta $0220
    lda highlight_x,x
    sta $0223
    lda #182
    sta $0221
    lda #1
    sta $0222
bank_indicator:
    lda buttons
    and #BTN_A
    beq effect_indicator
    lda #175
    sta $0224
    lda #180
    sta $0225
    lda #2
    sta $0226
    lda #119
    sta $0227
effect_indicator:
    lda buttons
    and #BTN_B
    beq done
    lda #199
    sta $0228
    lda #181
    sta $0229
    lda #2
    sta $022A
    lda #119
    sta $022B
done:
    rts
.endproc

.proc nmi
    pha
    txa
    pha
    tya
    pha
    lda ui_ready
    beq restore_scroll
    lda #0
    sta $2003
    lda #2
    sta $4014
    jsr draw_ui
restore_scroll:
    lda #0
    sta PPUSCROLL
    sta PPUSCROLL
    lda #$80
    sta PPUCTRL
    inc frame
    pla
    tay
    pla
    tax
    pla
    rti
.endproc

irq:
    rti

.segment "RODATA"
direction_bits: .byte $02, $04, $08, $01 ; left, down, up, right
giant_rows:     .byte $4E, $6E, $8E, $AE ; x14 y10..13
label_hi:       .byte $23, $23, $22, $23
label_lo:       .byte $03, $67, $A7, $0B ; C x3y24, D x7y27, E x7y21, G x11y24
particle_x:     .byte 32, 58, 84, 110, 136, 162, 188, 214
highlight_x:    .byte 24, 56, 56, 88
highlight_y:    .byte 198, 222, 174, 198
pluck_envelope: .byte 12,12,11,10,9,8,7,6,5,4,3,3,3,3,3,3
burst_lead:     .byte 12,10,8,6,4,2,1,0,0,0,0,0,0,0,0,0
burst_octave:   .byte 0,0,0,0,0,0,0,0,8,6,4,3,2,1,0,0
palette:
    .byte $0F,$30,$28,$20, $0F,$2A,$28,$20
    .byte $0F,$27,$28,$20, $0F,$10,$28,$20
    .byte $0F,$28,$30,$20, $0F,$2A,$30,$20
    .byte $0F,$27,$30,$20, $0F,$21,$30,$20
.include "tables.inc"
screen:
.incbin "screen.nam"

.segment "VECTORS"
.word nmi, reset, irq

.segment "CHARS"
.incbin "tiles.chr"
