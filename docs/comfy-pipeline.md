# Comfy 파이프라인 (웹 ↔ RunPod)

## 선택한 방향: `texture` (2번)

표지 원본 + **텍스처 프롬프트만** → Comfy에서 Reference/텍스처 결합 → Save Image.

단순 CLIP 물성 변경(`material`, `change to 3D` 등)은 사용하지 않습니다.

## 모드

| mode | Comfy 구간 | RunPod `input` |
|------|------------|----------------|
| **`texture`** (기본) | Load Image(표지) + Text(텍스처) → 결합 워크플로 → Save | `image`, `texture_prompt`, `image_name` |
| `material` | (레거시) CLIP Text Encode 물성/스타일 | `image`, `prompt` |
| `texture_map` | (레거시) material + texture 동시 | `image`, `prompt`, `texture_prompt` |

## 웹 흐름

1. 아카이브에서 표지 선택 → `image` (base64 data URL)
2. 한글 **텍스처** 설명 → **번역** → `/api/refine` (`purpose: texture`) → EN 후보
3. EN 옵션 버튼 중 하나 선택 → **Generate**
4. **이미지 업로드**: `POST /api/upload` → S3/R2에 업로드 → `https://...` URL 확보
5. `POST /api/runpod/run` → `buildRunPodInput({ mode: "texture", texturePrompt, imageUrl, imageName })`

## RunPod Serverless worker 계약 (`input`)

```json
{
  "mode": "texture",
  "texture_prompt": "wood grain, brushed oak surface",
  "image": "https://<public-url>/covers/....png",
  "image_name": "1976_example.png",
  "workflow": {}
}
```

- `workflow`는 `RUNPOD_INPUT_PROMPT_ONLY=0` 이고 repo에 export JSON이 있을 때만 Next가 붙입니다.
- 기본(`RUNPOD_INPUT_PROMPT_ONLY=1` 또는 미설정)은 **프롬프트 필드만** 전송 → worker가 GitHub에 올린 API workflow로 노드를 패치해야 합니다.

Worker는 `workflow["171"].inputs.url_or_path`에 들어간 **HTTPS URL**을 LoadImageFromUrlOrPath로 읽고,
`workflow["147"].inputs.value`(키워드)와 `workflow["159"].inputs.noise_seed`(랜덤 시드)를 반영해 실행한 뒤,
Save Image 출력을 URL 또는 base64로 반환합니다.

## 노드 id 수정

`lib/comfy/pipeline.js`의 `NODE_MAP`과 `workflows/cover-pipeline.json` 최상위 키를 Comfy **API format export** id와 맞춥니다.

`COMFY_WORKFLOW_FILE=workflows/your-export.json` (.env)

## RunPod 배포 체크리스트 (Pod → Serverless)

1. Pod ComfyUI에서 워크플로 **Export (API format)**
2. ComfyUI-to-API 업로드 → Analyze → Dockerfile 확인
3. GitHub repo 생성 → RunPod ↔ GitHub 연결
4. Serverless Endpoint 생성 → `RUNPOD_ENDPOINT_ID`, `RUNPOD_API_KEY`를 `.env`에 설정
5. Endpoint에서 `mode: texture` + 샘플 `image`/`texture_prompt`로 호출 테스트
6. 이 Next 앱에서 Generate로 E2E 확인
