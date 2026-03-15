/**
 * GLB 모델 크기 측정 스크립트
 * 사용법: node scripts/measure-glb.mjs <glb파일경로>
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const filePath = process.argv[2];

if (!filePath) {
  console.log('사용법: node scripts/measure-glb.mjs <glb파일경로>');
  console.log('예: node scripts/measure-glb.mjs "../house_sample_glb/Meshy_AI_man_0315144539_texture.glb"');
  process.exit(1);
}

const fullPath = resolve(filePath);
console.log(`\n파일: ${fullPath}\n`);

try {
  const buffer = readFileSync(fullPath);

  // GLB 헤더 파싱
  const magic = buffer.toString('ascii', 0, 4);
  if (magic !== 'glTF') {
    console.log('유효한 GLB 파일이 아닙니다.');
    process.exit(1);
  }

  const version = buffer.readUInt32LE(4);
  const length = buffer.readUInt32LE(8);

  console.log(`GLB 버전: ${version}`);
  console.log(`파일 크기: ${(length / 1024 / 1024).toFixed(2)} MB`);

  // JSON 청크 읽기
  const jsonChunkLength = buffer.readUInt32LE(12);
  const jsonChunkType = buffer.readUInt32LE(16);
  const jsonData = buffer.toString('utf8', 20, 20 + jsonChunkLength);
  const gltf = JSON.parse(jsonData);

  // 메시 정보
  if (gltf.meshes) {
    console.log(`\n메시 수: ${gltf.meshes.length}`);
  }

  // accessors에서 POSITION 찾기
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  if (gltf.accessors) {
    for (const accessor of gltf.accessors) {
      if (accessor.min && accessor.max && accessor.type === 'VEC3') {
        minX = Math.min(minX, accessor.min[0]);
        minY = Math.min(minY, accessor.min[1]);
        minZ = Math.min(minZ, accessor.min[2]);
        maxX = Math.max(maxX, accessor.max[0]);
        maxY = Math.max(maxY, accessor.max[1]);
        maxZ = Math.max(maxZ, accessor.max[2]);
      }
    }
  }

  if (minX !== Infinity) {
    const width = maxX - minX;
    const height = maxY - minY;
    const depth = maxZ - minZ;

    console.log('\n=== 모델 바운딩 박스 (미터 단위 가정) ===');
    console.log(`X (너비): ${width.toFixed(3)} m`);
    console.log(`Y (높이): ${height.toFixed(3)} m`);
    console.log(`Z (깊이): ${depth.toFixed(3)} m`);
    console.log(`\n원본 모델 높이: ${height.toFixed(3)} m`);
    console.log(`180cm로 만들려면 스케일: ${(1.8 / height).toFixed(2)}`);
  } else {
    console.log('\n바운딩 박스 정보를 찾을 수 없습니다.');
  }

} catch (err) {
  console.error('오류:', err.message);
}
