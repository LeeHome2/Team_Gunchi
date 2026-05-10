"""
Building Cluster — 같은 건물 DXF 파일 묶기.

raw_dir 의 모든 DXF 를 building_id 별로 그룹화.
1차: 폴더 = 건물 (raw_dir/{building_id}/*.dxf)
2차: 단일 파일이면 stem 의 prefix 휴리스틱
"""
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path
from typing import Dict, List


# 층 라벨 패턴 (파일명에서 제거하면 건물 ID 추출)
FLOOR_SUFFIX_PATTERNS = [
    r"[_\s\-]?B?\d+F?L?$",     # _1F, _B1, _2F, _F1
    r"[_\s\-]?지하?\d*층?$",    # _지1층, _지하1
    r"[_\s\-]?\d+층?$",         # _1층, _2
    r"[_\s\-]?(RF|roof|옥상|지붕)$",
]


def extract_building_id(filename: str) -> str:
    """파일명에서 건물 ID 추출.

    예: "house_a_1F.dxf" → "house_a"
        "apt_2층.dxf" → "apt"
        "arquitectura.dxf" → "arquitectura"
    """
    stem = Path(filename).stem

    for pat in FLOOR_SUFFIX_PATTERNS:
        stem = re.sub(pat, "", stem, flags=re.IGNORECASE)

    # 빈 문자열이면 원본 stem 사용
    return stem.strip("_- ") if stem.strip("_- ") else Path(filename).stem


def cluster_buildings(raw_dir: Path) -> Dict[str, List[Path]]:
    """raw_dir 의 모든 DXF 를 building_id 별로 그룹.

    1차: 폴더 = 건물 (raw_dir/{building_id}/*.dxf)
    2차: raw_dir 직속 DXF — 파일명 prefix 추출

    Returns:
        {building_id: [dxf_path, ...]}
    """
    groups: Dict[str, List[Path]] = defaultdict(list)

    if not raw_dir.exists():
        return dict(groups)

    # 1차: 폴더 그룹
    for folder in raw_dir.iterdir():
        if not folder.is_dir():
            continue
        dxfs = list(folder.glob("*.dxf")) + list(folder.glob("*.DXF"))
        if dxfs:
            groups[folder.name].extend(sorted(dxfs))

    # 2차: raw_dir 직속 DXF — 파일명 prefix 추출
    for dxf in sorted(raw_dir.glob("*.dxf")) + sorted(raw_dir.glob("*.DXF")):
        building_id = extract_building_id(dxf.name)
        groups[building_id].append(dxf)

    return dict(groups)


def cluster_all(
    manual_dir: Path,
    auto_dir: Optional[Path] = None,
) -> Dict[str, List[Path]]:
    """manual + auto 디렉토리 모두 클러스터링.

    Args:
        manual_dir: 수동 업로드 디렉토리 (data/raw/manual)
        auto_dir: 크롤러 자동 수집 디렉토리 (data/raw/auto) — 없으면 무시

    Returns:
        {building_id: [dxf_path, ...]}
    """
    groups = cluster_buildings(manual_dir)

    if auto_dir and auto_dir.exists():
        # auto 디렉토리는 날짜별 폴더 구조일 수 있음
        # data/raw/auto/2026-05-XX/building_name/*.dxf
        for date_folder in auto_dir.iterdir():
            if date_folder.is_dir():
                auto_groups = cluster_buildings(date_folder)
                for bid, paths in auto_groups.items():
                    # auto 소스 표시를 위해 prefix 추가
                    full_bid = f"auto_{date_folder.name}_{bid}"
                    groups[full_bid].extend(paths)

    return dict(groups)


def infer_floor_from_filename(filename: str) -> tuple:
    """파일명에서 층 정보 추론.

    Returns:
        (floor_label, floor_index) — 추론 실패 시 (None, -999)

    예:
        "house_1F.dxf" → ("1F", 0)
        "apt_B1.dxf" → ("B1", -1)
        "building_RF.dxf" → ("RF", 999)  # 나중에 보정
        "random.dxf" → (None, -999)
    """
    stem = Path(filename).stem.upper()

    # 지하층 패턴
    match = re.search(r"B(\d+)", stem)
    if match:
        n = int(match.group(1))
        return (f"B{n}", -n)

    # 옥상층 패턴
    if any(x in stem for x in ["RF", "ROOF", "옥상", "지붕"]):
        return ("RF", 999)  # 나중에 실제 최상층 + 1로 보정

    # 지상층 패턴
    match = re.search(r"(\d+)F|(\d+)층", stem)
    if match:
        n = int(match.group(1) or match.group(2))
        return (f"{n}F", n - 1)  # 0-based

    # 단순 숫자
    match = re.search(r"[_\-](\d+)$", stem)
    if match:
        n = int(match.group(1))
        if 1 <= n <= 100:  # 합리적인 층수 범위
            return (f"{n}F", n - 1)

    return (None, -999)


# Optional import 대비
from typing import Optional
