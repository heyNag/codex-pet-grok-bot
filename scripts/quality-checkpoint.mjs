import { createHash } from "node:crypto";
import { animationTimeline } from "../src/animation-timeline.mjs";

export const QUALITY_CHECKPOINT_CONTRACT = Object.freeze({
  id: "checkpoint",
  referenceId: "frozen-30x990-v1",
  label: "Frozen checkpoint · 30 phases",
  frames: 30,
  loopMs: 990,
  raster: "legacy",
});

const FRAME_HASHES = Object.freeze({
  dark: frozenHashes(`
e25b27e24826ab2ada300e806e389d5e0b3d5143590da4b6217c981360cd687c
46e62e6a8449db1acbd43033d44373074a13c1789ef4663d57072f50ef8e8e4c
1fd80ab5690838e558ecbfbf772fc2b128167c517389607e61787d65cfcad7d2
f60f82bd8c3334506c9f0d6c461326b65396eed8ddf7fec87aa6e4a7abd3fcc1
8383e0faa75b969a84da7df88a2cc74b538fb800ac535c94fb857debc0fc807b
ef20165159ce3932eeaa2ae63f50162ec654a1bf92734ba60db33e07d1f3fb2d
040ea889fac8332c8d6cfe46a905f0c1a6bcfccbe538a65fa48f71124a500fd9
6c1f9bd4235cc7afacb6db6619c941867927c7bf19175067644ccbb9296643c3
90e177ba30b3a0ee2c91032cc0e9646032b9797eb5604951b49483c03d7aad97
f3083e5a19c303de1b9e91f3e38d1a2d674a7bc59b96e5872e487e6b3f60b182
d537a602dc5dc6ff03441f1089df6ebcc9d5a98198af0aa58c076058986873bd
f92d7090b7d32eda57160018d624ebf2356d4206ecdbbfd68f8bfe547c66bcf8
cb5aa7a070897a66065d4168c6db08f71dd35c237f3f5259f115d94b4587baf5
4990a1d5c783105cca5d22464dd1c0d9ed8420f86ec84669419d815ff3a23a9d
3950615da3c0cddf03a3cd236361740e0f252f16c5dd194446191fe51ec625ae
5346a00f763a7dce07f5de4031e988c4e32a4183ad7b5697c8c5acdb2a55d3b2
4ba079a1907488b09c2da3f0ce1738b434900e2022c41d0cccb70cbe7128a106
5c4dede32784b707c6e96b5c15e946dd8c6e439adb7f6ed131f0d8070218258e
6be9912bc0749413d801e3c77415f372c9646242e19f45184b529efd67ea4c16
02f8684a44a6519ef6cdac5e20782acc1c2aa0dfee8b3d307a8b1bfcc3b3727a
65248a657a6111737c2f0694dd6149bd85981102e5a2be65b0352c357557a155
5758b7936307fb4d91eacc7beb91ebb3a86972f4a27cccdf70e26dda73058a23
d565cd6ae87e52e87c8e83901a867a5729bb1ff980ccaf36c74ab39c4a358cae
a8d1c0fa45ca27f3c6ebdead06730e06c020565c487b6dba9869dfdb03ecdc5a
06177fdd31b903d73676a7f966dc6bafbf340ab9ce88c141028e1e3b9e56090d
89024efce7572f2036e1cfae1bcb68eefaa813b74ec058f4c8f25ae903e24374
fc723fff02206d5861fb33490c154a6206c8e5b23fa7a24273d5a696eef0d8e2
48129b2614c6af2f6aa04df5c1d43dcac0f0266798072b63ca5b288576f71212
650d8017615bad44866fb923bf3ced226527222561f805b0ae89b178f92fbbcb
4b203cbd6a969e9579a575a27d1d5f65f87d1748324bf8c677fbf7072eb75227
`),
  light: frozenHashes(`
301992f8b4f7b0c81bc4a3ae3fa968959b2706ba87189e0abe0760174c76405f
9406ac67d47612e6ce189176113c28913f0a63accab94e0974279fef84ecee13
2bff3c97289e2401a16a83839fe7cb5e81c0f8526265f2e806aa64c765509c49
a0f97471fb73ee652303e0d4caaf2362476a6acc8c83a63bedf1a894f9340cae
bd8ee0ef0f03c3d470a41dea81bf682684c2eac574b17a68c850b8f518561e12
7c35fa36e975b56b49c8df927f58f58d0007c0aefc6d59694278397ed2e1d30e
42fa9f9ca347db39ad0b808dfa2dcdac6396aadcc08b5d017326488dfb14fce5
bb9e2a7663ebaaae6edd1f7df36ef11403c74f559094c7eb72492e85ffd44a08
64bb2fe6d2b3fe04b07de041dc63289bcfe12652c952ff361c4b480253812df4
2706fa0345fbf589180dfb8817613bc0a1804b0232e5adb230c430d23fb81b1e
5f10c7c7b63bb09510a40326ad2232dc497f4bc8d2e15a673354c647c3bf11c8
2d83272c794fd06bf1d4cb065322081d7e4b0dc6180f71b0cddf7ebb7e0ca753
b0032d5a1f527aae6e3c6dfc916206a16449f9b6869fbfa46c7aa72b3837f90e
6757431a246dcb0366d7c2a61a30c72389bf6a0b5866813c306ce5f2f272184e
6ac0b733b04fbef2b9f6aa504392818929dc3eb05a39d10ca3c9700a0563d64c
1153917830fc08518d99e9c444fb13cd2cbc65e61f3d3270b1f8460ac385aede
1d379b397988d12efbb5d4a13cb7b7b3d2cab0a3d084b99199b8425ebb627ab5
7848d8cd4ef6c1676cfa5eea88a3dcbd701749c3d330993eb0da8a5bdc58f282
eba34dde7d71d7477fc85dd942fee81b1722f2ff66451941f23be56e91d2a88a
879effdb296b93ed0eac5b4aa2e83363b343b47d20882bf27caa792808412dd1
77ed19a7a18d6ed6eaec3bd8c6cf76ac1a6f05549a814b45215e756edda7972f
0aebcafceb81d1a97bca64dfe6c74f68790c5515cca6d745570f3d6f26e892e8
6520dfaa47068c2f4061bcc64ed43be380e9f6671d907bf5d14ae72ce8747a5a
dff362be04afef86947a0274fd198c2780a6aa251977678fcea6cb4fa5c6e51a
55e390dc6a5af75bf1f35e72688c7581fe37aee21b93a5057de47d728d04931f
d0dd86025ffd238404c185de8408cc7059d008c18c11fb6b9c1b36948b260370
9ebe9e9f38434abfe078b87c26e483b595a327c1da1dd90fc471116835ad5d51
9992914296dc99dab4c30ccae47377cc7410572bf4782c7bdd3cb07b7ce66d92
f43b3e84d61e5caf05c99db5cf1241c2f39f6c0c9d76257296fa9a30ef1a8433
e61e1eab45bfdd88bb02ca28ec1bf2b2444116a2c24cae4ac0101e811d56e340
`),
});

export function qualityCheckpointTimeline() {
  return animationTimeline(QUALITY_CHECKPOINT_CONTRACT.frames, QUALITY_CHECKPOINT_CONTRACT.loopMs);
}

export function qualityCheckpointFrameHashes(theme) {
  const hashes = FRAME_HASHES[theme];
  if (!hashes) throw new Error(`Unknown quality checkpoint theme: ${theme}`);
  return hashes;
}

export function qualityCheckpointFrameHashSeal(hashes) {
  if (!Array.isArray(hashes) || hashes.length !== QUALITY_CHECKPOINT_CONTRACT.frames
    || hashes.some((value) => !/^[a-f0-9]{64}$/u.test(value))) {
    throw new Error(`Quality checkpoint needs ${QUALITY_CHECKPOINT_CONTRACT.frames} ordered SHA-256 frame hashes`);
  }
  return createHash("sha256").update(hashes.join("\n")).digest("hex");
}

export function validateQualityCheckpointManifest(manifest, theme) {
  const expectedHashes = qualityCheckpointFrameHashes(theme);
  const timeline = qualityCheckpointTimeline();
  const expectedDelays = timeline.map(({ durationMs }) => durationMs);
  const expectedSeal = qualityCheckpointFrameHashSeal(expectedHashes);
  const errors = [];
  if (manifest?.id !== QUALITY_CHECKPOINT_CONTRACT.id || manifest?.theme !== theme
    || manifest?.referenceId !== QUALITY_CHECKPOINT_CONTRACT.referenceId
    || manifest?.frames !== QUALITY_CHECKPOINT_CONTRACT.frames
    || manifest?.loopMs !== QUALITY_CHECKPOINT_CONTRACT.loopMs
    || manifest?.raster !== QUALITY_CHECKPOINT_CONTRACT.raster) {
    errors.push("frozen checkpoint identity or render contract differs");
  }
  if (!same(manifest?.delays, expectedDelays) || !same(manifest?.timeline, timeline)) {
    errors.push("frozen checkpoint timing differs");
  }
  if (!same(manifest?.decodedFrameHashes, expectedHashes)
    || manifest?.decodedFrameHashSeal !== expectedSeal) {
    errors.push("frozen checkpoint decoded frames differ");
  }
  return { ok: errors.length === 0, errors, expectedHashes, expectedSeal, timeline };
}

function frozenHashes(text) {
  const hashes = text.trim().split(/\s+/u);
  if (hashes.length !== QUALITY_CHECKPOINT_CONTRACT.frames
    || hashes.some((value) => !/^[a-f0-9]{64}$/u.test(value))) {
    throw new Error("Invalid frozen quality checkpoint frame hash table");
  }
  return Object.freeze(hashes);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
