# Prepare and export an avatar from Blender

ILMU loads a **skinned GLB with PBR materials and ARKit face shape keys**. A
Unity FBX, its Animator Controller, and its custom shaders are not a portable
avatar package. Prepare the model in Blender, export it, then test the exported
file in the SDK itself.

This workflow was exercised with Blender 5.2.2 and ILMU Avatar SDK 2.0.0. The
same GLB skeleton was also tested with Unity 6000.0.60f1 and glTFast 6.19.0.
Exact panel labels can differ between Blender versions.

## 1. Check the character before export

- Keep one armature and only the meshes for the intended outfit. Hide unused
  hair, clothes and accessories, then explicitly select the wanted meshes and
  their armature for export. A visible mesh with Render disabled needs attention
  too: make viewport and render visibility agree.
- Every deforming mesh must be bound to that armature, with working vertex
  weights and an Armature modifier. Test an arm and a leg in Pose Mode, then
  return to the authored rest pose.
- Preserve the skeleton hierarchy and bone rest transforms. ILMU recognises
  Unreal, Mixamo, Character Creator and supported Rigify bone names. There is
  no need to rename an Unreal rig to Mixamo. Arbitrary rigs may need mapper
  changes; the required bones are listed in `sdk.md`.
- Keep the model upright, with a sensible standing height. An A-pose is
  supported: ILMU aligns the arms for retargeting. Do not use an animation frame
  as the model's new bind pose.
- Do not move the skeleton root out of its armature object after import. Do not
  blindly apply or clear transforms on an already bound rig. A 0.01 armature
  scale from an FBX import is not by itself a failure; the mesh, skeleton and
  inverse bind matrices must remain consistent.
- Keep face shape keys, including `jawOpen`, `mouthPucker`, `mouthFunnel`,
  `mouthClose`, `eyeBlinkLeft` and `eyeBlinkRight`. The full 52 ARKit set gives
  more complete expressions. Check teeth as well as the head. Set expression
  values to zero for the neutral export.

The armature's rest pose, mesh weights and face shape keys do different jobs.
Renaming bones will not repair bad weights or a changed bind pose.

## 2. Make portable materials

Use **Principled BSDF → Material Output** with image textures connected to the
inputs glTF understands:

| Texture | Connection / colour space |
|---|---|
| Base colour | Image Texture → Base Color; sRGB |
| Roughness / metallic | Corresponding input; Non-Color |
| Normal | Image Texture → Normal Map → Normal; Non-Color |
| Hair / eyelash alpha | Appropriate alpha input and material transparency |

Check UVs and make sure all connected images load. Use **File → External Data
→ Pack Resources** to make the saved `.blend` self-contained before moving it
to another machine. GLB embeds the textures it actually exports.

Unity skin, hair and eye shaders are not transferred from an FBX. Blender
procedural effects, displacement and complex node groups also need an export
compatible material or baking into textures. A coloured Blender viewport alone
does not prove the GLB contains those materials. Inspect the exported file.

Opaque skin and clothes should remain opaque. Hair, lashes and corneas may
need transparency; do not force every material to opaque to fix a sorting issue.
Check backface culling on thin clothing, and confirm both eyes use the intended
materials.

For an initial web test, cap textures at **1024 pixels** on their longest side.
Use higher resolution selectively after checking download size and appearance.
This is a starting budget, not an SDK format requirement.

## 3. Export the character

Use **File → Export → glTF 2.0**:

| Setting | Value for an ILMU character |
|---|---|
| Format | glTF Binary (`.glb`) |
| Include | Selected Objects; select the armature and wanted skinned meshes |
| Materials | Export, with image textures |
| Skinning | Enabled |
| Shape Keys / morph targets | Enabled; retain their names |
| Shape Key Normals | Enabled |
| Apply Modifiers | Disabled for this workflow; applying the stack can lose shape keys |
| Animations | Disabled: ILMU uses a separate animation library |
| Rest Position Armature | Enabled, when this option is available |
| Cameras / lights | Disabled |

Export to a new file first. Do not overwrite the working model while diagnosing
a failure. Reimport the GLB into a fresh Blender scene to check that textures,
skinning and face shape keys survived. Do not save that round trip over the
source `.blend`.

SDK 2.x needs a separate `animations.glb` and matching `animationSet` catalogue
for body motion. The character GLB does not need to contain idle, talking or
wave clips. If the delivered build has no animation library, a still body is
expected even with a valid character. See the animation section in `sdk.md`.

## 4. Validate in the SDK

Serve the SDK over HTTP. In its test console, load the `.glb` through the file
picker, or call:

```js
await avatar.init();
await avatar.loadAvatar("avatars/my-character.glb");
```

For SDK 2.x, use `setFraming("full")` to inspect the entire body and
`setFraming("head")` to inspect the face. Check:

1. Textures appear on skin, clothes, hair, eyes and teeth.
2. Given a configured animation library, idle, thinking, talking, nod and wave
   retain the correct orientation, scale and limb poses.
3. A mouth timeline opens and rounds the lips, then relaxes to neutral. Test
   a closed-lip sound as well as a vowel. Use the console's supplied test audio
   to avoid depending on a real speech service during this check.
4. Eyelids blink and eye movement reaches the intended shapes.
5. Thin clothes and hair look correct throughout motion, not only at rest.
6. Full framing includes the feet; switching models does not leave a broken
   pose or old model behind. Check the browser console for loading errors.

Unity physics, cloth simulations, constraints and secondary-motion scripts do
not become SDK behaviour just because their mesh is exported. Hair and skirt
helper bones need supported baked animation, suitable skin weights, or a
separate runtime solution. A correctly retargeted body can still poke through
an outfit that was only checked in a static pose.

## 5. If you test the GLB in Unity

Import through glTFast, preserving the imported hierarchy. **Do not put the
source FBX's Avatar into the GLB's Animator.** An Animator Controller can be
shared; the Humanoid Avatar must describe the target GLB's skeleton and rest
pose. Matching bone names alone are not sufficient.

The ILMU runtime loader builds that target-specific Humanoid automatically.
Loading through `ILMUAvatarRuntime.LoadAvatar()` in the main scene is the
representative SDK 1.x test. Merely dragging the GLB into a scene and assigning
the original FBX Avatar bypasses this preparation.

In the ILMU Unity source project, two editor tools help with a plain GLB scene
object:

- **Tools → ILMU → GLB → Create Validation Scene From Selected Character**
  compares the scene instance and fresh GLB with a rebuilt Humanoid, samples
  the configured animation clips, and creates a separate validation scene.
- **Repair Selected Scene Character From Fresh GLB** creates a fresh instance
  with its own Humanoid and keeps the old object inactive as a backup. It handles
  a plain character root with an Animator; custom root components need to be
  preserved separately. Save the scene after checking the result.

These editor tools are for the source project; customers using SDK 2.x do not
need Unity.

## Troubleshooting

| Symptom | Check first |
|---|---|
| White / untextured model | Exported material nodes, image connections, missing image files and UVs |
| Body rotated, flattened or distorted in Unity | Borrowed FBX Avatar, changed root hierarchy, mismatched rest transforms |
| Body never moves | Required skeleton bones, animation library and catalogue; Unity Humanoid setup |
| Face never moves | Morph targets retained, ARKit names and supported face channels |
| Face explodes | Morph target range and loader; do not scale GLB morph weights like FBX weights |
| Skirt or hair clips during movement | Skin weights and secondary bones; exported GLB does not contain a cloth solver |
| Works locally, fails on a hosted page | GLB address, HTTP, CORS and the build manifest |

## Reference

- [Blender glTF exporter: materials, skinning and shape keys](https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html)
- [Unity Rig settings: reusing an Avatar requires an identical rig](https://docs.unity3d.com/6000.0/Documentation/Manual/FBXImporter-Rig.html)
