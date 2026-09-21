# Laser-cutting DXF — Scratch-to-Open Cat Door

Foam-board prototype panels ported to MDF. Dimensions and mechanics are
unchanged; only the material thicknesses differ.

## Materials

| | Thickness | Used for | Sheet |
|---|---|---|---|
| MDF | **3 mm** | panel, base, braces, channels, servo mount | A, B (600×300) |
| MDF | **2 mm** | flap only | C (200×200) |

**Why two thicknesses.** Channel slot depth = spacer thickness.
A 3 mm spacer gives a 3 mm slot; a 3 mm flap in it has zero clearance and jams.
**A 2 mm flap leaves 1 mm of clearance.** Laser-cut edges are smooth, so 1 mm is enough.

3 mm is the standard laser-cutting thickness: a 40–60 W machine cuts it in one pass.

## Files

```
sheetA_MDF_3T.dxf    600×300 — panel, base #1, servo plate, ribs ×2, LED visor, stopper
sheetB_MDF_3T.dxf    600×300 — braces ×2, base #2, spacers ×2, covers ×2, spares
sheetC_MDF_2T.dxf    200×200 — flap ×2 (one spare)
*_2.7T.dxf           same layout re-fit for 2.7 mm stock
*_tr.dxf / _FIXED    revised nesting variants
```

## Layers

| Layer | Operation |
|---|---|
| `CUT` | cut |
| `ENGRAVE` | engrave (assembly guide lines). Optional, but they make assembly easier |
| `SHEET` | sheet outline. **Do not cut** — layout reference only |

## Parts list

| No. | Part | Qty | Thickness | Notes |
|---|---|---|---|---|
| 01 | Panel 200×260 | 1 | 3T | 70×70 opening, 3 bottom tabs |
| 02 | Base 200×200 | **2** | 3T | **glue 2 layers = 6 mm** so clamps cannot crack it |
| 03 | Brace | 2 | 3T | right triangle 90×160, 4 tabs |
| 04 | Channel spacer 180×10 | 2 | 3T | creates the slot depth |
| 05 | Channel cover 180×22 | 2 | 3T | grips 12 mm of the flap edge |
| 06 | Bottom stopper 90×8 | 1 | 3T | |
| 07 | Servo plate 60×60 | 1 | 3T | 2 slotted SG90 screw holes, Ø14 horn pass-through |
| 08 | Servo rib | 2 | 3T | 18 mm standoff |
| 09 | LED visor 116×20 | 1 | 3T | for direct sunlight outdoors |
| 10 | Flap 90×85 | 2 | **2T** | Ø3 string hole, engraved weight positions |

## Servo mount

The SG90 body does **not** pass through the plate. The flange sits on the front
face and is held by two M2 screws.

- Screw slots: ±13.9 mm from center, **8×2.8 slots** — absorbs hole-spacing
  variation between units
- Ø14 hole: clearance for the horn boss
- The two ribs stand the plate **18 mm off the panel**, so the arm clears the
  channel cover (rear face, Y=79) by 7.5 mm

## Assembly order

```
1. Glue the two base sheets together (6 mm)              cure 2 h
2. Glue channel spacers, then covers, to the panel back  align to engraved lines
3. Insert the flap and free-fall test it                 <- checkpoint
4. Add M8 nuts until the flap weighs 30–40 g (2T MDF is 11 g)
5. Fit the panel's bottom tabs into the base slots
6. Fit both braces into the panel and base slots         check squareness
7. Fit the two servo ribs into the panel slots, seat the servo plate
8. Fasten the servo with two M2 screws; connect arm and string
9. Scratch pad, LEDs, visor, sensors, wiring
```

Tabs press-fit lightly thanks to the kerf (~0.15 mm). If loose, one drop of wood glue.

## Changes from the foam-board version

| | Foam board | MDF |
|---|---|---|
| Panel | 5 mm | **3 mm** |
| Channel spacer | 5 mm | 3 mm |
| Flap | 3 mm foam, 2 g | **2 mm MDF, 11 g** |
| Slot clearance | 2 mm | **1 mm** (smooth cut edges make it enough) |
| Assembly | all glued, aligned by eye | **tab-and-slot self-alignment** |
| Base | 12 mm plywood | two 3T layers = 6 mm |
| Weights | 6–8 M8 nuts | **4 are enough** |

The heavier flap and smoother surfaces **greatly reduce the free-fall failure
risk**, and the torn string holes seen with foam board are gone.

## Cautions

- **MDF is very sensitive to water.** Once wet it swells and is permanently
  damaged. The outdoor-booth rule stands: if it rains, pick it up and retreat.
- Laser-cut edges carry soot. Wipe with a dry cloth before assembly to keep it
  off hands and clothes.
- Cutting 3 mm MDF needs ventilation. Follow your makerspace's rules.
