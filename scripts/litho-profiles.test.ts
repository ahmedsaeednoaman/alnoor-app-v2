import assert from "node:assert/strict";
import { calculateProfileLineEffectiveAmount, normalizeProcedureSet, validateLithotripsySessionNumber } from "@/lib/accounting/lithotripsy-profiles";

assert.equal(normalizeProcedureSet(["b", "a", "b"]), "a,b");
assert.equal(calculateProfileLineEffectiveAmount(450, 200), 650);
assert.equal(calculateProfileLineEffectiveAmount(450, -50), 400);
assert.equal(calculateProfileLineEffectiveAmount(450, 0), 450);
assert.throws(() => calculateProfileLineEffectiveAmount(450, -500), /أقل من صفر/);
assert.equal(validateLithotripsySessionNumber(1), 1);
assert.equal(validateLithotripsySessionNumber(2), 2);
assert.throws(() => validateLithotripsySessionNumber(0), /حدد الجلسة/);
assert.equal(validateLithotripsySessionNumber(3), 3);
assert.throws(() => validateLithotripsySessionNumber(null), /حدد الجلسة/);
console.log("Lithotripsy pricing profile domain tests passed");
