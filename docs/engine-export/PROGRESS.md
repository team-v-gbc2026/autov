# Native 3D export implementation progress

Base: origin/main 58652df, branch feature/engine-vfx-export. User requires true 3D (not flipbooks), local verification first, Unity/Godot real-engine tests and minimal Unreal importer. No PR/push/merge yet.

## Current implementation
- Runtime node materials carry a stable program identifier.
- Browser exporter records expanded geometry/seed attributes, live uniforms and transforms at 15/30/60 Hz; saves source JSON, native kernels, adapters and WebGPU reference stills.
- 17 reference GLSL kernels convert to Godot spatial shaders; all 17 passed Godot 4.7.2 shader-language validation (dummy renderer, not yet visual validation).
- 17 Unity shaders generated with Khronos glslang (npm @webgpu/glslang 0.0.15) + SPIRV-Cross; actual Unity import/compilation still pending.
- Godot standalone orbitable demo; Unity prefab importer + player; Studio export modal.
- Browser smoke test successfully exported fire-projectile: 8 native draws, ~30 MB ZIP at 15Hz.

## Important outstanding work
- Real Godot rendering/parity, loader uniform typing, textures, orientation, engine color response.
- Unity installation still in progress via Unity Hub; verify build + rendering when ready.
- Unreal importer not implemented yet. Export README presently refers to it prematurely; fix before delivery.
- Product UI, automated tests, resource limits, general fixture coverage and source/adapter copying need verification.
- Improve camera-dependent sorting / camera-anchored transforms; currently baked from reference camera with warning.
- Postprocessing and soft depth are excluded; never claim full parity yet.

## Local tools and outputs
- Node: /Users/kawadaiki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
- npm: /private/tmp/autov-shader-tools/npm/package/bin/npm-cli.js (npm ci from tracked package-lock completed)
- Godot (user installed): /Users/kawadaiki/Downloads/Godot.app/Contents/MacOS/Godot (4.7.2)
- Unity Hub installing 6000.6.1f1 in /Applications/Unity/Hub/Editor; incomplete .app may appear/disappear during install.
- Khronos tools: /private/tmp/autov-shader-tools/package/dist/node-devel/glslang.js and /private/tmp/autov-shader-tools/spirv-cross, built from official repo.
- Run preview: from frontend, `node scripts/engine-export/preview.mjs` -> http://127.0.0.1:4317 . Button writes files to frontend/.autov-local/engine-export/<fixture>/ with per-process token.
- Generated fixture: frontend/.autov-local/engine-export/fire-projectile/ (source, JSON, PNG, native shaders and adapters).
- Adapter sources live under adapters/; copies under frontend/public/engine-export/ are bundled. Keep in sync.

## Baseline
Initial tsc reported only missing generated Next LayoutProps; run Next typegen before evaluating typecheck results. Existing main has 17 programs, unlike linked AVFX plan's outdated 5-program assumption.


## 2026-09-17 実機検証の続報
- Godot 4.7.2 Forward+ / Apple M4: 8 draws の炎を3方向で再生・撮影。共有 InstancedInterleavedBuffer を頂点属性として誤読する不具合を修正し、粒子・煙が復旧。geometry.test.mts の回帰テスト2件が成功。
- Godot uniformTypes をmanifestに追加し、int / bool / scalar配列を明示変換。正面・側面・背面の参照との差は効果領域MAEが15.20 / 15.54 / 15.55 (0..255、参照RGB最大値>35)。背景・トーンマッピング差が残る。絶対的な品質合格とはしない。
- Unity 6.6 (6000.6.1f1) Editor導入完了。初回インポートと3方向キャプチャ成功。iCloud配下でUnityがAssetsフォルダを一時的に見失ったため、/private/tmp/autov-engine-validation/unity-fresh に新規プロジェクトを作り、再インポート成功。ログ /private/tmp/autov-unity-fresh.log に AVFX_VALIDATION_COMPLETE。
- Unity SetInt はfloatへの別名なので SetInteger に修正。まだ粒子材質が期待どおり出ない。ローカルコピーのfragmentを診断用マゼンタにすると粒子の四角は描画されるため、次はfragmentのuniform/texture/alphaを切り分ける。診断変更は元に戻した。公開ソースには診断色を入れていない。
- ユーザーの希望によりUnity Editorで Assets/AVFX/Validation.unity を開き、Playを開始。CUAスクリーンショットで実際の炎の再生を確認。Unityは見た目未完成である旨を伝えている。
- Unity validation harness: frontend/scripts/engine-export/unity/AvfxValidation.cs。初回double literalをfloatへ修正。現シーンは最後の180度視点、通常Unity座標カメラで保存されている。比較用はカメラ行列を明示するため見た目が異なる。ユーザー向けorbit previewと色調統一が必要。
- Godot editor とライブ再生を起動済み。CUAはeditorウインドウを選ぶ。プロジェクト一覧への登録は未検証（CLI --editor起動は成功、ユーザーが空一覧を示した問題の解決確認が残る）。
- geometry.ts をexport.tsから分離。tscでThreeの型定義に isInstancedInterleavedBuffer が欠けたためintersection型で補完した。補完後のtsc再実行は未実施。
- Unreal用binary.tsはまだ未使用。READMEのUnreal記載が先行しているので最小実装を完成するか正確に修正すること。目標は未完了。


## 2026-09-17 Unityの粒子・テクスチャを復旧
- 前回goalターンは実機再生を伴うprogress。今回もGPU診断とソース修正を実施。
- /private/tmp/autov-engine-validation/unity-diagnostic を表示用 unity-fresh と別に作成し、描画を切り分けた。CPU読み戻しは uCurveBN=4、uLife=(.3,.65)、uTime=.75。診断fragmentのRGB=(uCurveBN/4,uCurveB[1].y,uLife.x)ではマゼンタとなり、GPUでfloat2配列の成分が欠落することを確認。
- generate-kernels.mts: 数値配列をfloat4配列へ拡張し、参照時の .x/.xy/.xyz を生成。AvfxPlayer.SetVectorArrayも全配列をfloat4として送る。Metalで配列のstride不一致を回避。17プログラムを再生成。
- その後、粒子が四角として復旧したがテクスチャが欠落。Shader Propertiesへ全sampler2D宣言を追加し、保存されたMaterialからtexture参照が失われないよう修正。再インポート後、粒子マスク・細部が復旧した。通常描画のスクリーンショットを確認済み。
- 最新の成功ログ /private/tmp/autov-unity-textures.log は AVFX_VALIDATION_COMPLETE。最新Unity比較画像は /private/tmp/autov-engine-validation/unity-diagnostic/Captures/unity-view-{0,90,180}.png。診断用の出力改変はすべて通常コードへ戻した。
- 残る主差分は色調。Unity比較harnessはまだACES/sRGB出力を揃えていないため赤く暗い。次は実際のプレビュー用カメラでHDR・ACES・sRGBを揃え、UIでも同じように見える状態へ進む。表示中の unity-fresh はこの最新修正の再インポート前なので更新が必要。
- TypeScript --noEmit 成功。geometry.test.mts 2/2成功。
- 比較ツール frontend/scripts/engine-export/compare.mjs を追加。両画像の明部のunionでMAEを測り、差分画像(4倍)とJSONを保存。Godot 3方向のunion MAE=14.23/14.71/14.80。これは炎1例の現状値であり一般的合格判定ではない。
- Unreal最小インポーター、複数エフェクトの実機検証、製品UI動作、永続的な成果物配置と手順は未完了。goalはactiveを維持。


## 2026-09-17 色調の一致とPreview prefab
- 前回はGPU診断・修正を伴うprogress。今回はUnity/Godotの色調を実機画像で改善。
- Unity: AvfxPreviewTone.cs/.shader を追加。ThreeのACES fit + 明示sRGB出力（同梱THREE-LICENSE.txt）。Builtin OnRenderImageでHDR sourceを変換し、GL.sRGBWrite=falseで二重変換回避。検証の出力RTはARGB32/Linear。炎3方向 foreground-union MAE=1.3716/1.9135/2.6043 (0..255)、全画像MAE=.1055/.1543/.1345。ログ /private/tmp/autov-unity-tone.log、画像 unity-diagnostic/Captures。
- Godot: native ACESのinput scale1.8をThreeの1/.6へ合わせるためexposure/1.08。白色点の追加正規化を1にするtonemap_white=14.260243850354401。公式tonemap.glslとfit式から算出。炎MAE=1.4332/2.0624/3.3051、全画像MAE=.1156/.1692/.1659。/private/tmp/autov-godot-tone.log。Godot/demo.gdはソース・public・fire出力へ反映済み。
- AvfxPreviewCamera.cs: 参照camera行列を保持するorbit/zoom/space pause。AvfxImporter.CreatePreviewはEditorSceneManager.NewPreviewScene内にEffectとCameraを組み、Preview.prefabを保存して閉じる。既存ユーザーsceneを触らない。Preview sceneのSaveはUnityが許さず、途中2案は失敗したが現在Prefab生成で成功。ログ /private/tmp/autov-unity-preview.log AVFX_VALIDATION_COMPLETE、Imported 11/Preview.prefab等の生成を確認。
- ImportSelectedはEffectを取り込んでPreview.prefabを作り選択する。空sceneへPreviewを置いてPlayする導線。Builtinのみ参照tone stack対応。製品UIの実操作はまだ未確認。
- Validation harnessは同じAvfxPreviewCamera/Toneを使い比較、最後にyaw0へ戻してValidation.unityを保存。表示中unity-freshは古い版のため、新しい検証sceneへ切替か再インポートが必要（まだ未実施）。
- fixture smoke-burstをブラウザーから初めて試した。blobのinstanceCount=0の初期フレームで失敗→空geometry/不可視sampleとして保持するよう修正。Godotの空ArrayMesh対応と回帰テスト追加（この追加後のテスト実行は次回）。
- 次のsmoke-burst再試行は192MB上限に達した。理由候補: CPUで変化するblobの属性が球の全頂点に展開され、毎frameで大きいgeometry JSONを重複保持。上限を無闇に上げず、静的base geometry共有とinstance属性のcompact encodingが必要。元runtimeのinstance属性はInstancedInterleavedBuffer。Shader attributeBytesは今全頂点へ複製、Godot VERTEX_ID/Unity uv2 indexで参照。ここをcompact化する際は両adapterを一緒に修正・検証すること。
- 現在previewサーバーは4317、CUA exportTab はiab tab3、smoke-burst選択で192MBエラー表示。元tab2は消えたので再作成済み。複数fixture・Unreal・UI・ドキュメント最終化は未完了。


## 2026-09-17 — Final two presentation cases and Windows handoff

- User selected **Fire Projectile and Shield**, replacing smoke in the presentation acceptance set.
- Committed native exporter/importers and published via connected GitHub API because local HTTPS git push lacked credentials. Remote commit `3e3eca61837aaf37e3c24dc57d0f252d0e74ed46` has exactly the same tree as local checkpoint `1c42d4d`; local branch synchronized after verifying tree equality, checkpoint branch preserved. No PR/main merge.
- Re-exported Fire Projectile using current compact-geometry/float-texture/face-orientation code: 8 draws. Fresh permanent Unity project imported both cases and saved scenes; three views per case captured without compile/render errors.
- Foreground MAE Fire Projectile: Unity 1.3234 / 1.8821 / 2.5771; Godot 1.4077 / 2.0568 / 3.3139 (0/90/180 degrees). Shield: Unity 0.8474 / 0.7266 / 0.7334; Godot 0.2094 / 0.2087 / 0.2001. RGB byte units, fixed reference time .7333333333.
- Permanent local demo: `/Users/kawadaiki/Projects/AutoV-VFX-Presentation`. Unity standalone macOS build succeeded, opened and visibly rendered Fire Projectile. The effect-switch button has not yet been confirmed to change scenes in the live app; resolve before calling presentation fully complete. Godot three-view captures succeeded from both permanent bundle locations.
- User requested a self-contained Windows / UE 5.8 handoff. Added WINDOWS-UE58-HANDOFF.ja.md, with exact repo/branch, data contracts, Windows setup, two-case shader scope, honest Unreal-unimplemented status, measured evidence, and completion criteria. Local transfer archive includes the two export zips and native engine captures.
- Fixed Unity shader URL/generator output case (`Unity`) to match tracked paths on case-sensitive servers.
- Remaining: finish presentation controls/relaunch validation, product Studio Export UI verification, and Unreal importer (Windows handoff prepared; no UE runtime available on this Mac).


## 2026-09-17 — Standalone controls and Studio export integration

- Published handoff/presentation checkpoint as `bcb7f04502ceb967cfea8c86f7cebe612da638f3`; no PR or merge.
- Increased presentation control size, added 1/2 scene selection, arrow-key orbit, 0 reset, and enabled background playback. Built the standalone app again and relaunched it; both Fire Projectile and Shield rendered. Key 2 selected scene 1 in Player.log; key 1 returned to Fire Projectile; Space pause inspected. Native mouse automation over IMGUI buttons did not trigger selection, so mouse activation is not claimed verified.
- Started Next locally. Turbopack failed while spawning its Node CSS worker despite a PATH correction; the supported `--webpack` switch successfully launched the same code. No application source change for this environment issue.
- Mounted the production Studio component via existing `/dev/vfx-studio-v2?fixture=...` routes. Clicked Export 3D, selected 15 Hz, exported Fire Projectile (8 draws) and Shield (7 draws); both completed in the actual dialog. This verifies UI integration, not authentication/project persistence.
- Geometry/data tests: 5 passed; TypeScript noEmit passed before these C#-only control changes. Unity standalone final build completed successfully.
- Unreal importer remains unimplemented. The Windows handoff is available locally as a 9.1 MB archive with coherent export zips, reference/native captures, comparison metrics and SHA256 checksums.

## 2026-09-17 — Unreal asset ingestion foundation

- Added `adapters/unreal/avfx_prepare.py`: validates bundle references/base geometry/timing, writes a manifest binding plan, preserves PNGs and converts raw float attributes/data to uncompressed 32-bit FLOAT EXR. This does not substitute a flat preview or diagnostic mesh for the requested 3D rendering.
- Prepared Fire Projectile (8 draws / 120 texture sources) and Shield (7 draws / 8 float sources). Corrected float metadata suffix to `.rgba32f.json` after the first Shield run rejected a nonexistent path.
- Independent OpenEXR 3.4.15 + NumPy 2.0.2 decoder in an isolated temp venv verified every RGBA float32 bit for all 111 + 8 generated float textures. Preparation needs only the standard library; decoder libraries are verification-only.
- Added UE Editor Python import draft: new-folder-only staging, source checksums, float32/linear/no-mip/nearest data texture settings, and explicit runtime-missing report. Syntax validated; UE APIs/imported precision/runtime are NOT verified because UE is not installed on this Mac.
- This is asset-ingestion progress, not completion of Unreal VFX reproduction. Shader port, actual UE import/render checks, and playable demo remain.

## 2026-09-17 — Independent particle/surface HLSL

- Extracted two-case HLSL programs from the existing generated kernels, removing Unity ShaderLab wrappers and exposing front-face inversion as an explicit define rather than silently reusing Unity's setting.
- Added a kernel manifest with source SHA, entry points, uniform types, compact attribute field order, vertex semantics and array/matrix conventions.
- Built official Khronos glslang 16.5.0 (`a8d28bd082bff18ffbe80996e922b012f915cf07`) with HLSL enabled in /private/tmp. Standalone compilation found `float2 half2` (GLSL local colliding with an HLSL type); extraction renames the local without changing arithmetic. Unity shaders were not changed.
- Both vertex stages and fragment stages with face inversion 0/1 pass independent HLSL-to-SPIR-V compilation (6 configurations). The repeatable verifier checks source SHA and compiler exit/output.
- No UE shader registration, mesh render path, player or UE render validation is claimed. These remain required integration work; the source/shader/data contracts are now explicit inputs for that work.


## 2026-09-17 — Godot presentation relaunch and controls

- Launched the permanent Fire Projectile command. Closed the old generated editor after accepting its external-file reload, then closed the old source-directory game so it could not be mistaken for the current demo. No user project was modified.
- Added optional presentation HUD and 1/2 sibling-bundle switching to demo.gd; arrow orbit, R reference time and 0 reset are available. Player replacement removes the old node rather than accumulating geometry. Mirrored browser-distributed demo and permanent bundle copies.
- Verified native UI: Fire Projectile reference frame, key 2 -> Hex Shield, R -> fixed frame, right arrows -> visibly different 3D viewpoint. Constant source folder launch now shows actual playback directly.
- Re-ran 0/90/180 captures with HUD disabled: Fire MAE 1.4077 / 2.0568 / 3.3139; Shield 0.2094 / 0.2087 / 0.2001. Identical to the earlier measurements.
- Updated launcher generator to request presentation mode and copy the latest demo controls. Shell syntax and Godot headless import passed.
- Requested Windows Codex work status asynchronously to avoid conflicting Unreal implementation; no reply at the time of this entry. Unreal runtime integration remains incomplete; other work has continued.
