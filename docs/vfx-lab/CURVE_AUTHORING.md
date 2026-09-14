# Curve authoring

The Motion inspector exposes the layer's existing curve properties with a domain label and live graph. Flat curves have a compact slider; expand a control to choose Constant, Linear ramp, Smooth ramp, or Attack / hold / release and edit its parameters. Existing custom keyframes are preserved until a preset is selected.

V2 curves retain `keys` and `ease` and accept an optional `formula`:

```json
{"keys":[[0,1],[1,0]],"ease":"smooth","formula":{"kind":"smooth","start":1,"end":0,"peak":1,"attack":0.15,"release":0.65}}
```

Formula is authoritative during document validation. Constants, linear ramps, smoothstep ramps and smoothstep envelopes compile exactly to existing piecewise curves, avoiding a separate CPU/GPU evaluator. All formula parameters are bounded and no executable expressions are accepted. Formula fields must all be supplied; unused fields are ignored. Attack is .001–.499; release is .501–.999. Remove formula when directly changing keyframes.

Domains remain field-specific: particle lifetime, layer lifetime, or spatial position. Layer scheduling and motion tracks in seconds are separate. Existing scalar-only properties remain scalar; this change does not make every renderer setting animatable. Optional curve-bearing components must exist before their controls appear.
