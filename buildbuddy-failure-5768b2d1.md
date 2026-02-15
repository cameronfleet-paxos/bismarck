# BuildBuddy Invocation Failure Report

**Invocation ID:** 5768b2d1-8ae8-4fbf-b660-433e83a6f54f
**Invocation URL:** https://paxos.buildbuddy.io/invocation/5768b2d1-8ae8-4fbf-b660-433e83a6f54f
**Date:** 2026-02-13 22:35:07 UTC
**Branch:** RP-4995-fuzzy-person-search
**Commit:** 892bd897a1aa36f0557c6ece7ecd0446c41ddc11

## Summary

Build completed successfully, but 1 test target failed remotely with 7 failing test cases.

```
Executed 343 out of 5331 tests: 5330 tests pass and 1 fails remotely.
Test cases: finished with 434 passing and 7 failing out of 5846 test cases
```

## Failed Test Target

**Target:** `//pkg/kyc/server:identity_admin_test`
**Status:** FAILED (Exit 1) - failed in all 3 attempts
**Duration:** 110.2s

### Log Locations
- `/home/buildbuddy/workspace/output-base/execroot/_main/bazel-out/k8-fastbuild/testlogs/pkg/kyc/server/identity_admin_test/test.log`
- `/home/buildbuddy/workspace/output-base/execroot/_main/bazel-out/k8-fastbuild/testlogs/pkg/kyc/server/identity_admin_test/test_attempts/attempt_1.log`
- `/home/buildbuddy/workspace/output-base/execroot/_main/bazel-out/k8-fastbuild/testlogs/pkg/kyc/server/identity_admin_test/test_attempts/attempt_2.log`

## Failing Test Cases (7 total)

### 1. `server.TestAdminListIdentities`
- **Duration:** 4.1s
- **Sub-test:** `SearchLastName` - FAILED

### 2. `server.TestIdentityMatchingSearch`
- **Duration:** 3.7s
- **Sub-tests:**
  - `SortingInstitutionBestMatchOnTop` - FAILED
  - `SortingPersons` - FAILED

### 3. `server.TestInternalAdminListIdentities`
- **Duration:** 4.8s
- **Sub-test:** `SearchLastName` - FAILED

## Additional Flaky Test

**Target:** `//pkg/funding/transfers/tests/integration/funding/fiat:intrabank_withdrawal_test`
**Status:** FLAKY - failed in 1 out of 2 attempts
**Duration:** 222.4s

## Root Cause Analysis

All failing tests are related to **identity search functionality**, specifically:
- Last name search functionality (`SearchLastName`)
- Identity matching and sorting algorithms (`SortingInstitutionBestMatchOnTop`, `SortingPersons`)

This suggests the PR's fuzzy person search implementation (RP-4995) may have:
1. Broken exact last name search
2. Altered sorting behavior for identity matching results
3. Affected both admin and internal admin search APIs

## Error Details

```
BAZEL ERROR code=3 message="Build OK, but some tests failed or timed out."
Error: error executing job 'Pull Request': bazel tests failed; Build OK, but some tests failed or timed out.: exit status 3
```

## Datadog Report

https://app.datadoghq.com/ci/redirect/tests/https%3A%2F%2Fgithub.com%2Fpaxosglobal%2Fpax.git/-/buildbuddy/-/RP-4995-fuzzy-person-search/-/892bd897a1aa36f0557c6ece7ecd0446c41ddc11?env=ci

## Related Invocation

Build results streamed to: https://paxos.buildbuddy.io/invocation/554b75a0-7924-4b01-9516-22682071347a
