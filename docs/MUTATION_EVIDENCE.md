# Mutation evidence

Each property test in `src/__tests__/properties.test.ts` was checked by making one small, deliberate break in the source and running only that property. Every time, the source file was first copied to a backup. After the run it was restored from that backup and compared with `cmp`, which printed no difference. The full suite (9 suites, 138 tests) passed again after all five restores.

The table is from the run on 2026-11-22, after the review fixes. Properties 1 to 3 were checked again on the fixed code and properties 4 and 5 are new. Commands, run from the repository root:

```sh
cp <file> <backup>            # backup
# apply the one-line change below
timeout 300 npx jest src/__tests__/properties.test.ts -t "property N"
cp <backup> <file>            # restore
cmp <backup> <file>           # no output, exit 0
```

| Property | File | Deliberate break | Result with the break | Counterexample from fast-check | Restored, `cmp` |
| --- | --- | --- | --- | --- | --- |
| 1. Verifying a `signWebhook` result is ok for any payload and secret | `src/providers/juspay.ts` (verifier) | `` utf8(`${credentials.username}:${credentials.password}`) `` changed to `` utf8(`${credentials.username}${credentials.password}`) `` (the verifier drops the `:` the signer sends) | Fails: `juspay` ✕. The other five gateways still pass. 1 failed, 5 passed, jest exit status 1 | `[{}, {"username":"!","password":"\u0000"}]` | Byte-identical |
| 2. Any single-byte change to the raw body makes verification fail | `src/providers/cashfree.ts` (`cashfreeSignature`) | `concatBytes(utf8(timestamp), body)` changed to `concatBytes(utf8(timestamp), body.subarray(0, 0))` (the signature stops covering the body) | Fails: `cashfree` ✕. Razorpay, PayU and Easebuzz still pass. 1 failed, 3 passed, jest exit status 1 | `[{}, "!", {"position":0,"xor":1}]` | Byte-identical |
| 3. `amountMinor` is an integer string that round-trips the documented unit | `src/core/amount.ts` (`minorFromDecimal`) | `fraction.slice(0, 2).padEnd(2, '0')` changed to `fraction.slice(0, 2)` (one-decimal rupees lose a digit: `12.5` becomes `125` instead of `1250`) | Fails: `cashfree and juspay` ✕ and `payu and easebuzz` ✕. Integer-paise gateways still pass. 2 failed, 1 passed, jest exit status 1 | `[100343963410]` and `[976562500, 0]` | Byte-identical |
| 4. A request without valid authentication only gets `missing_header` or `bad_signature` | `src/providers/form.ts` (`verifyForm`) | The reason for a body without a `hash` field changed from `'missing_header'` to `looksLikeJson(body) ? 'unsupported_event' : 'missing_header'` (the behaviour before the fix) | Fails: `payu` ✕ and `easebuzz` ✕. The other four gateways still pass. 2 failed, 4 passed, jest exit status 1 | `["{}", {}, "\u0000", {"username":"!","password":"!"}]` (PayU) | Byte-identical |
| 5. `verifyWebhook` never throws and never rejects, for any `provider` and `options` | `src/index.ts` (`describeProvider`) | `` return provider === null ? 'null' : `a value of type ${typeof provider}`; `` changed to `return String(provider);` (the unknown-provider message calls the value's own conversion, as before the fix) | Fails: `for arbitrary provider and options` ✕. 1 failed, jest exit status 1 | `[[Object.create(null)], ""]` (an array holding an object with no prototype, which `String()` cannot convert) | Byte-identical |

Notes:

- The first attempt at the property 2 break removed the `body` argument completely. That run failed with TypeScript error TS6133 (unused parameter) before any test ran, so it proved nothing. It was replaced with the `body.subarray(0, 0)` version above, which compiles and fails only the property.
- The first attempt at the property 5 break replaced the call `describeProvider(provider)` with `String(provider)`. That left `describeProvider` unused, so it also failed with TS6133 and ran no tests ("Tests: 0 total"). It was replaced with the change inside `describeProvider` above.
- The property 2 break leaves property 1 passing for Cashfree, because the signer and the verifier share `cashfreeSignature`. Only the tamper property catches it, which is why that break was chosen for property 2.
- PayU and Easebuzz hash decoded field values, not body bytes, so for them property 2 is tested at field level (any change to one hashed value). The README explains why.
- Property 1's generators no longer produce blank secrets or credentials, because the verifiers now reject them with `invalid_options` (review finding 1). Its form payload generator also skips field sets whose names decode to the same name, which the verifiers now reject as repeated fields.
