# UI reference port — 2026-10-20

## Baseline and scope
- Branch: ui-port-20261019; HEAD: 5b9480410a1a0d53576ccfc85ef59d049f03213f.
- Five existing dirty page files were preserved. Pre-edit copies: .scratch/ui-baseline-20261020/.
- Reference: sibling seak-lead-agent-ui-download/docs/design/ui (HTML concepts and README). Its production components still use older plain UI and standalone CurrentNote; these business differences were not ported.
- No commit, merge, push, schema, AI, capture or task engine changes.

## Presentation
- Local system fonts; 16px page/brand headings, 13px body, 12px controls and supporting text.
- Background #F5F4ED, white cards, primary #3B5BC9 / hover #30489E; yellow #FFC64F selected-navigation and evidence accents.
- 8px controls, 12px cards, 8–12px spacing; explicit text for task/partial/error states, keyboard focus retained.
- Four-column navigation, flexible/wrapping actions and filters, long-text wrapping, differentiated primary/danger buttons.
- Product selection/profile/history retained. Discovery setup remains batch-only; long rules in a disclosure and concise safety notice visible. Task status/controls, per-note details and partial outcomes retained.
- Leads retain filters/export/corrections with clearer evidence; settings use grouped cards. No additional dependency or external font request.

## Files
- entrypoints/sidepanel/App.tsx: shell, four-page navigation.
- entrypoints/sidepanel/Products.tsx: input, selected product, profile/history cards.
- entrypoints/sidepanel/Discovery.tsx: setup, rules, task/result presentation.
- entrypoints/sidepanel/Leads.tsx: filters, actions, cards, evidence.
- entrypoints/sidepanel/Settings.tsx: grouped controls/status/danger actions.
- entrypoints/sidepanel/sidepanel.css: shared visual tokens and narrow layout styles.
- tests/unit/sidepanel-presentation.test.ts: 3 real-component regressions (navigation/targets, count validation, empty-key feedback).

## Evidence
- TypeScript and ESLint: PASS.
- Initial full Vitest: 42 files, 503 passed, 0 failed.
- New component tests: 1 file, 3 passed.
- Final full suite: see final validation below.
- Edge production build and ZIP (npm run zip:edge): PASS; 12 archive entries byte-identical to .output/edge-mv3.
- git diff --check: PASS.
- AST comparison with pre-edit copies: all 117 on*/value/checked/disabled/onboarding-target bindings unchanged.
- Edge browser local synthetic preview uses actual App with a stub browser API on localhost, isolated from extension data and credentials. Four page switches, onboarding start/pause/resume, 101-post error, settings layout observed. Leads content width320, scrollWidth319; no horizontal overflow there.
- This preview is NOT the installed extension sidebar. Populated long cards, actual API connection, live task controls, per-note retry/recollection, actual export and retained user history remain manual acceptance items. No real Xiaohongshu run: NOT VERIFIED.
- Screenshot: .scratch/ui-review-leads.png (full browser image). Cropped screenshot request timed out; no claim of cropped capture.

## Artifact
D:\AI-Toys\seak-lead-agent\.output\seeklead-agent-0.1.0-edge.zip
390117 bytes
SHA-256: 8CF83883373D85DEC10128A25B276D5071CD90885AD5E411FC8C8F6AD95C0B40
Load unpacked: D:\AI-Toys\seak-lead-agent\.output\edge-mv3

## Manual acceptance
Reload the existing extension (do not uninstall/clear data), check 320/380px sidebar widths and long populated products/leads; verify keyword copy/confirmation, 1–100 validation, task pause/resume/stop, details/retry/reanalysis, correction/filter/export, onboarding continuation and existing history. Do not bypass platform verification.

Final validation: 43 Vitest files, 506 tests passed, 0 failed (74.60s). No baseline assertion changes. Git HEAD unchanged; 6 tracked files modified and 2 new files (test/report), intentionally uncommitted. Tracked diff: 121 insertions, 58 deletions; includes the five pre-existing dirty files.
