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
SOUND_COUNT = 3

.segment "HEADER"
.byte "NES", $1A, 1, 1, 0, 0 ; 16K PRG, 8K CHR, NROM, horizontal mirroring
.byte 0, 0, 0, 0, 0, 0, 0, 0 ; iNES, NTSC, no battery or trainer

.segment "ZEROPAGE"
frame:          .res 1
last_frame:     .res 1
; This contiguous context is swapped between live, first loop, and second loop.
voice_begin:
buttons:        .res 1
previous:       .res 1
pressed:        .res 1
direction:      .res 1
base_octave:    .res 1
note_slot:      .res 1
note_id:        .res 1
old_note:       .res 1
gate:           .res 1
lead_volume:    .res 1
note_age:       .res 1
release_clock:  .res 1
delay_pos:      .res 1
echo_id:        .res 1
echo_volume:    .res 1
echo_pitch:     .res 1
echo_previous:  .res 1
effect_clock:   .res 1
sound:          .res 1
rendered_sound: .res 1
old_sound:      .res 1
attack_flag:    .res 1
voice_age:      .res 1
triangle_on:    .res 1
triangle_pitch: .res 1
voice_pitch:    .res 1
noise_volume:   .res 1
pulse_pitch:    .res 1
apu_shadow:    .res 16
apu_dirty:     .res 1
voice_end:
VOICE_SIZE = voice_end - voice_begin

ui_ready:       .res 1
ui_note:        .res 1
ui_octave:      .res 1
ui_base:        .res 1
ui_bank:        .res 1
ui_labels:      .res 4
ui_sound:       .res 1
ui_loop:        .res 1
ptr:            .res 2
temp:           .res 1
sprite_index:   .res 1
phase:          .res 1
nmi_tile:       .res 1
raw_buttons:    .res 1
raw_previous:   .res 1
raw_pressed:    .res 1
selected_octave: .res 1
selected_sound: .res 1
sound_latch:    .res 1
start_hold:     .res 1
live_muted:     .res 1
loop_state:     .res 1 ; 0=live, 1=armed, 2=recording, 3=playing, 4=adding part
loop_position:  .res 2
loop_length:    .res 2
dub_remaining:  .res 2
layer_present:  .res 1
loop_started:   .res 1
encoded_note:   .res 1
voice_index:    .res 1
voice_offset:   .res 1
pulse_one:      .res 1
pulse_two:      .res 1
triangle_owner: .res 1
noise_owner:    .res 1
old_pulse_one:  .res 1
old_pulse_two:  .res 1
old_triangle:   .res 1
old_noise:      .res 1
mix_level:      .res 1
mix_owner:      .res 1
mix_previous:   .res 1
mix_mask:       .res 1
mix_source:     .res 1

.segment "BSS"
voice_states:   .res VOICE_SIZE * 3
delay_notes:    .res 16 * 3
delay_volumes:  .res 16 * 3
.align 256
loop_first:     .res 512
loop_second:    .res 512

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
    ldx #0
hide_sprites:
    sta $0200,x
    inx
    bne hide_sprites
    lda #2                ; begin at C4
    sta selected_octave
    jsr reset_all_voices
    lda #64               ; fixed DAC level, no sample playback or DMC DMA
    sta $4011
    lda #$08
    sta $4001
    sta $4005
    lda selected_octave
    sta base_octave
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
    jsr global_controls
    jsr perform_frame
    jsr animate
    jsr prepare_ui
    lda #1
    sta ui_ready
    jmp main
.endproc

.proc read_controller
    lda raw_buttons
    sta raw_previous
    lda #1
    sta PAD
    lda #0
    sta PAD
    sta raw_buttons
    ldx #8
read_bit:
    lda PAD
    and #1
    lsr a
    rol raw_buttons
    dex
    bne read_bit
    lda raw_previous
    eor #$FF
    and raw_buttons
    sta raw_pressed
    rts
.endproc

.include "controls.inc"

.proc choose_note
    lda #0
    sta attack_flag
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
    lda sound
    cmp old_sound
    bne attack
    lda gate
    bne held
attack:
    lda #1
    sta attack_flag
    lda sound
    sta old_sound
    lda note_id
    sta old_note
    tax
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

.include "voices.inc"
.include "mixer.inc"

.proc prepare_ui
    lda sound
    sta ui_sound
    lda loop_state
    cmp #3
    bne ui_state
    ldx layer_present
    beq ui_state
    lda #5
ui_state:
    sta ui_loop
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
    lda sound
    cmp #2
    bne melodic_label
    lda drum_ascii,y
    jmp label_ready
melodic_label:
    lda note_ascii,y
label_ready:
    sta ui_labels,x
    iny
    inx
    cpx #4
    bne copy_labels
    lda gate
    beq resting
    ldx note_slot
    lda sound
    cmp #2
    bne melodic_note
    lda drum_glyph,x
    sta ui_note
    lda #' '
    sta ui_octave
    rts
melodic_note:
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

; Only called during blanking. Runtime writes are checked in the emulator.
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
    lda #$8D             ; base octave at column 13, row 28
    sta PPUADDR
    lda ui_base
    sta PPUDATA
    lda #$20
    sta PPUADDR
    lda #$EC             ; patch name at column 12, row 7
    sta PPUADDR
    lda ui_sound
    asl a
    asl a
    asl a
    tax
    ldy #8
patch_name:
    lda sound_names,x
    sta PPUDATA
    inx
    dey
    bne patch_name
    lda #$22
    sta PPUADDR
    lda #$0C             ; loop state at column 12, row 16
    sta PPUADDR
    lda ui_loop
    asl a
    asl a
    asl a
    tax
    ldy #8
loop_name:
    lda loop_names,x
    sta PPUDATA
    inx
    dey
    bne loop_name
    lda #$23
    sta PPUADDR
    lda #$97             ; next Start action at column 23, row 28
    sta PPUADDR
    lda ui_loop
    asl a
    asl a
    asl a
    tax
    ldy #5
action:
    lda start_actions,x
    sta PPUDATA
    inx
    dey
    bne action
    rts
.endproc

.proc animate
    ldx #0
    stx sprite_index
    lda frame
    lsr a
    sta phase
particle:
    lda mix_level
    beq quiet
    lda phase
    and #31
    tay
    lda wave_y,y
    clc
    adc #148
    jmp position
quiet:
    lda #148
position:
    sta $0200,x
    lda #8
    ldy buttons
    tya
    and #BTN_B
    beq dot
    lda #9
    bne tile
dot:
    lda #8
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
    lda #10
    sta $0221
    lda #1
    sta $0222
bank_indicator:
    lda buttons
    and #BTN_A
    beq effect_indicator
    lda #167
    sta $0224
    lda #8
    sta $0225
    lda #2
    sta $0226
    lda #119
    sta $0227
effect_indicator:
    lda buttons
    and #BTN_B
    beq done
    lda #183
    sta $0228
    lda #9
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
label_hi:       .byte $22, $23, $22, $22
label_lo:       .byte $E3, $27, $87, $EB
particle_x:     .byte 32, 58, 84, 110, 136, 162, 188, 214
highlight_x:    .byte 24, 56, 56, 88
highlight_y:    .byte 190, 206, 166, 190
sound_names:    .byte "SQUARE  ","TRIANGLE","DRUMS   "
loop_names:     .byte "        ","READY   ","REC     ","LOOP    ","ADDING  ","2 PARTS "
start_actions:  .byte "REC     ","STOP    ","LOOP    ","ADD     ","DONE    ","REDO    "
pluck_envelope: .byte 12,12,11,10,9,8,7,6,5,4,3,3,3,3,3,3
burst_lead:     .byte 12,10,8,6,4,2,1,0,0,0,0,0,0,0,0,0
burst_octave:   .byte 0,0,0,0,0,0,0,0,8,6,4,3,2,1,0,0
voice_offsets: .byte 0,VOICE_SIZE,VOICE_SIZE*2
delay_offsets: .byte 0,16,32
voice_priority: .byte 0,2,1
drum_noise_period: .byte $0E,$06,$02,$0A,$07,$03,$83,$8A
drum_body_kind: .byte 1,0,0,2,0,0,0,3
drum_envelope_ptr_lo:
    .byte <kick_env,<snare_env,<hat_env,<tom_env,<clap_env,<open_env,<click_env,<zap_env
drum_envelope_ptr_hi:
    .byte >kick_env,>snare_env,>hat_env,>tom_env,>clap_env,>open_env,>click_env,>zap_env
kick_env: .byte 4,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
snare_env: .byte 15,13,11,9,8,7,6,5,4,3,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
hat_env: .byte 10,7,4,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
tom_env: .byte 3,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
clap_env: .byte 12,3,0,11,3,0,10,8,6,4,3,2,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
open_env: .byte 10,10,9,9,8,8,7,7,6,6,5,5,4,4,3,3,2,2,1,1,0,0,0,0,0,0,0,0,0,0,0,0
click_env: .byte 12,5,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
zap_env: .byte 4,4,4,3,3,2,2,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
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
