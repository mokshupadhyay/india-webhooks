# Mutation evidence

Each property test in `src/__tests__/properties.test.ts` was checked by making one small, deliberate break in the source and running only that property. Every time, the source file was first copied to a backup. After the run it was restored from that backup and compared with `cmp`, which printed no difference. The full suite (8 suites, 93 tests) passed again after all three restores.

Commands, run on 2026-11-22 from the repository root:

```sh
cp <file> <backup>            # backup
# apply the one-line change below
timeout 300 npx jest src/__tests__/properties.test.ts -t "property N"
cp <backup> <file>            # restore
cmp <backup> <file>           # no output, exit 0
```

| Property | File | Deliberate break | Result with the break | Counterexample from fast-check | Restored, `cmp` |
| --- | --- | --- | --- | --- | --- |
| 1. Verifying a `signWebhook` result is ok for any payload and secret | `src/providers/juspay.ts` (verifier) | `` utf8(`${credentials.username}:${credentials.password}`) `` changed to `` utf8(`${credentials.username}${credentials.password}`) `` (the verifier drops the `:` the signer sends) | Fails: `juspay` ✕. The other five gateways still pass. 1 failed, 5 passed, jest exit status 1 | `[{}, {"username":"","password":""}]` | Byte-identical |
| 2. Any single-byte change to the raw body makes verification fail | `src/providers/cashfree.ts` (`cashfreeSignature`) | `concatBytes(utf8(timestamp), body)` changed to `concatBytes(utf8(timestamp), body.subarray(0, 0))` (the signature stops covering the body) | Fails: `cashfree` ✕. Razorpay, PayU and Easebuzz still pass. 1 failed, 3 passed, jest exit status 1 | `[{}, " ", {"position":0,"xor":1}]` | Byte-identical |
| 3. `amountMinor` is an integer string that round-trips the documented unit | `src/core/amount.ts` (`minorFromDecimal`) | `fraction.slice(0, 2).padEnd(2, '0')` changed to `fraction.slice(0, 2)` (one-decimal rupees lose a digit: `12.5` becomes `125` instead of `1250`) | Fails: `cashfree and juspay` ✕ and `payu and easebuzz` ✕. Integer-paise gateways still pass. 2 failed, 1 passed, jest exit status 1 | `[238797255700]` and `[439141469690, 1]` | Byte-identical |

Notes:

- The first attempt at the property 2 break removed the `body` argument completely. That run failed with TypeScript error TS6133 (unused parameter) before any test ran, so it proved nothing. It was replaced with the `body.subarray(0, 0)` version above, which compiles and fails only the property.
- The property 2 break leaves property 1 passing for Cashfree, because the signer and the verifier share `cashfreeSignature`. Only the tamper property catches it, which is why that break was chosen for property 2.
- PayU and Easebuzz hash decoded field values, not body bytes, so for them property 2 is tested at field level (any change to one hashed value). The README explains why.
