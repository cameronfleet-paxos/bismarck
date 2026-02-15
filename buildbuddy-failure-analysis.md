# BuildBuddy Invocation Failure Analysis

**Invocation URL**: https://paxos.buildbuddy.io/invocation/5768b2d1-8ae8-4fbf-b660-433e83a6f54f

**Date**: 2026-02-13 22:21:49 - 22:35:11 UTC

**Branch**: RP-4995-fuzzy-person-search

**Commit**: 892bd897a1aa36f0557c6ece7ecd0446c41ddc11

## Summary

Build completed successfully, but **1 test target failed** with 7 failing test cases.

- **Total Tests**: 5331 test targets
- **Passed**: 5330 tests
- **Failed**: 1 test (remotely)
- **Test Cases**: 434 passing, 7 failing out of 5846 total test cases

## Failed Test Target

### `//pkg/kyc/server:identity_admin_test`

**Status**: FAILED (Exit 1)
**Attempts**: 3 (all failed)
**Duration**: 3 runs with stats:
- Max: 110.2s
- Min: 90.6s
- Avg: 100.6s
- Std Dev: 8.0s

**Log Files**:
- `/home/buildbuddy/workspace/output-base/execroot/_main/bazel-out/k8-fastbuild/testlogs/pkg/kyc/server/identity_admin_test/test.log`
- `/home/buildbuddy/workspace/output-base/execroot/_main/bazel-out/k8-fastbuild/testlogs/pkg/kyc/server/identity_admin_test/test_attempts/attempt_1.log`
- `/home/buildbuddy/workspace/output-base/execroot/_main/bazel-out/k8-fastbuild/testlogs/pkg/kyc/server/identity_admin_test/test_attempts/attempt_2.log`

**Remote Server Logs**:
- `/home/buildbuddy/workspace/output-base/bazel-remote-logs/009d2cc504109dc9365c9873f73189c7ea28670b09dd89c9f3e60b38e2fda502/vm_log_tail.txt`
- `/home/buildbuddy/workspace/output-base/bazel-remote-logs/1f3da8efcd7a0aa1f8186501cc6dad3fd72f74ea30d6c60756cc95cd5811d4f0/vm_log_tail.txt`

## Failing Test Cases

All failures are in the `server` package within `//pkg/kyc/server:identity_admin_test`:

1. ❌ `server.TestAdminListIdentities` (4.1s)
   - ❌ `server.TestAdminListIdentities/SearchLastName` (0.0s)

2. ❌ `server.TestIdentityMatchingSearch` (3.7s)
   - ❌ `server.TestIdentityMatchingSearch/SortingInstitutionBestMatchOnTop` (0.0s)
   - ❌ `server.TestIdentityMatchingSearch/SortingPersons` (0.0s)

3. ❌ `server.TestInternalAdminListIdentities` (4.8s)
   - ❌ `server.TestInternalAdminListIdentities/SearchLastName` (0.0s)

## Passing Tests in Same Target

The test target had many passing tests, including:

- ✅ `server.TestAdminActionIdentity` (3.3s)
  - All 8 subtests passed (Freeze IDV denied, Freeze Sanction denied, etc.)
- ✅ Various identity-related tests (55+ passing tests)

## Flaky Test (Not Failing)

- ⚠️ `//pkg/funding/transfers/tests/integration/funding/fiat:intrabank_withdrawal_test` - Marked as FLAKY (Exit 1 on attempt 1 only)

## Build Statistics

- **Total Actions**: 54,828
  - 31,373 action cache hits
  - 51,991 remote cache hits
  - 464 internal
  - 3 linux-sandbox
  - 2,370 remote

- **Elapsed Time**: 761.663s
- **Critical Path**: 706.21s

## Error Context

The failures are related to **identity search functionality**, specifically:
- Last name search in admin list identities
- Sorting logic for institution best match
- Sorting logic for persons
- Internal admin list identities with last name search

All failing subtests show 0.0s duration, suggesting they failed immediately (likely assertion failures or setup issues).

## Related Changes

Branch `RP-4995-fuzzy-person-search` suggests this is related to implementing fuzzy person search functionality, which aligns with the failing tests around identity searching and sorting.

## Next Steps

1. Review test logs to identify specific assertion failures
2. Check implementation of fuzzy search logic in `pkg/kyc/server`
3. Verify sorting algorithms for person and institution matching
4. Run tests locally to reproduce failures
5. Compare with main branch behavior for identity search tests
