# The vision eval set

Drop your photos in this folder. They are not decoration — they are the thing that decides whether
the central claim ("point it at the machine and it reads the fault") is true or marketing.

Everything else in this project can be built without them. This cannot.

## What to shoot

Six to ten photos, phone camera, no special care taken — the point is that they look like what
someone would actually take while annoyed in a kitchen.

| shot | why |
|---|---|
| A control panel **showing a fault code** | the primary read. Get one per appliance if you can. |
| The **model plate** sticker | usually inside the door, on the back, or under the lid. Small text, often at an angle. |
| One deliberately **bad** shot — glare, dim, slight blur | if it only works in good light it does not work |
| One panel with **no fault showing** | it must not hallucinate a code onto a healthy machine |

Any appliances: dishwasher, washer, dryer, fridge, oven, microwave, AC.

## Naming

```
  bosch-dishwasher-panel-e24.jpg
  bosch-dishwasher-plate.jpg
  lg-washer-panel-oe.jpg
  lg-washer-plate.jpg
  samsung-fridge-panel-clean.jpg      <- no fault showing
  whirlpool-dryer-plate-glare.jpg     <- the hard one
```

Model and code in the filename where you know them. That becomes the expected answer.

## What happens then

`expected.json` gets written alongside — the model number and fault code each photo really shows —
and the eval reports exact-match accuracy on both. Two numbers, honestly measured, in the README:

- how often it read the **fault code** correctly
- how often it read the **model number** correctly

If those numbers are poor, the camera claim goes and the product becomes voice plus the appliance's
own telemetry. Better to learn that in week one than to find out on camera.

## Privacy

Nothing here is committed unless the frame contains only the appliance. Check for reflections before
pushing — kitchens have windows, and windows have people in them.
