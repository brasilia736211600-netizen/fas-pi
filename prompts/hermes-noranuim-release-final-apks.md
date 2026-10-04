# Noranuim Release Mission

Repository: brasilia736211600-netizen/Noranuim
PR: #27
Reviewed HEAD: 11759f0

The user has explicitly authorized completion of this release operation.

- Fetch PR #27 first. Require OPEN, unmerged, clean/mergeable, base main, and exact HEAD 11759f0. Require all required checks green and no newer commit or blocking review. If any gate differs, stop and report.
- If every gate passes, merge PR #27 using the repository's normal merge method, with 11759f0 as the expected head.
- Verify the merged PR and resulting main SHA.
- Inspect existing GitHub Actions workflows and identify the canonical Android final/release APK workflow. Use its normal post-merge trigger; if a supported manual dispatch is required, use it. Do not invent a new workflow without repository evidence.
- Monitor the build to completion. If it fails, inspect the actual failing job and logs, diagnose it, and make only the smallest justified fix. Never weaken tests or claim success without evidence.
- After success, inspect workflow artifacts and verify the intended APK files exist and are downloadable. Record workflow/run ID, commit SHA, artifact names, variants, and checksums when available. Verify APK metadata when safely possible.
- Distinguish CI build verification, artifact verification, and device/runtime verification. Never claim device testing unless performed.
- Update existing canonical project/Hermes state only where appropriate; avoid redundant documentation.

Completion requires: PR #27 merged from 11759f0, main verified, final APK workflow successful, intended APK artifact(s) present/downloadable, and provenance recorded.

Final status: FINAL_APKS_READY, BLOCKED_BEFORE_MERGE, MERGED_BUILD_FAILED, MERGED_NO_APK_ARTIFACT, or PARTIAL_WITH_ACTION_REQUIRED.

Return concise evidence covering merge SHA, main SHA, workflow/run, successful jobs, APK artifacts, variants/checksums, and the verification boundary.