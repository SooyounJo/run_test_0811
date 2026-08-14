import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "@/styles/Home.module.css";

const POLL_MS = 1500;
// RunPod serverless는 큐 대기(콜드스타트/스로틀)로 5분 이상 걸릴 수 있음
const TIMEOUT_MS = 900000;
const NOTICE_AUTO_DISMISS_MS = 9000;
/** RunPod Serverless: texture_prompt + 표지 (Comfy 텍스처 결합 워크플로) */
const RUNPOD_PIPELINE_MODE = "texture";
const PIPELINE_RESULT_LABEL = "텍스처 결합";

const STYLE_PRESETS = [
  { id: "wood", label: "나무", text: "나무 결, 원목 질감" },
  { id: "steel", label: "강철", text: "강철, 브러시드 메탈 표면" },
  { id: "concrete", label: "콘크리트", text: "거친 콘크리트, 시멘트 질감" },
  { id: "marble", label: "대리석", text: "대리석 vein, polished stone" },
  { id: "fabric", label: "패브릭", text: "직물, 캔버스 천 질감" }
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function urlToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("이미지를 불러오지 못했습니다.");
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
}

function parseCoverYear(url) {
  const name = String(url || "").split("/").pop() || "";
  const m = /^(\d{4})_/u.exec(name);
  return m ? Number(m[1]) : null;
}

function formatElapsed(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatCoverTitle(urlOrName) {
  const name = String(urlOrName || "").split("/").pop() || "";
  const m = /^(\d{4})_(\d{2})(?:\D|$)/u.exec(name);
  if (!m) return name;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || !month) return name;
  return `${year}년 ${month}월 작품`;
}

export default function HomePage() {
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);

  const [catalogImages, setCatalogImages] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  /** null = 전체 연도 */
  const [filterYear, setFilterYear] = useState(null);
  const [selectedCatalogUrl, setSelectedCatalogUrl] = useState("");
  const [selectedImage, setSelectedImage] = useState(null);

  const [userPrompt, setUserPrompt] = useState("");
  const [textureOptions, setTextureOptions] = useState([]);
  const [selectedTextureOptionId, setSelectedTextureOptionId] = useState("");
  const [resultImageUrl, setResultImageUrl] = useState("");
  const [resultMeta, setResultMeta] = useState(null);

  const [statusText, setStatusText] = useState("");
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [runpodInfo, setRunpodInfo] = useState(null);
  const [error, setError] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);
  /** trimmedPrompt when EN prompts match current input */
  const [refinedForKey, setRefinedForKey] = useState("");
  const [topNotice, setTopNotice] = useState(null);

  const abortRef = useRef(null);
  const refineAbortRef = useRef(null);
  const noticeTimerRef = useRef(null);
  const promptRef = useRef(null);
  const waitStartRef = useRef(0);
  const waitIntervalRef = useRef(null);
  const runpodInfoRef = useRef("");

  const showTopNotice = useCallback((message, variant = "error") => {
    const text = String(message || "").trim();
    if (!text) return;
    setTopNotice({ message: text, variant });
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setTopNotice(null), NOTICE_AUTO_DISMISS_MS);
  }, []);

  const dismissTopNotice = useCallback(() => {
    window.clearTimeout(noticeTimerRef.current);
    setTopNotice(null);
  }, []);

  const clearResult = useCallback(() => {
    if (loading) return;
    setResultImageUrl("");
    setResultMeta(null);
    setStatusText("");
  }, [loading]);

  const isFocused = Boolean(selectedCatalogUrl);
  const isResultView = Boolean(resultImageUrl && resultMeta);
  const isWaiting = Boolean(loading && !isResultView && String(statusText || "").includes("대기"));

  useEffect(() => {
    if (!isWaiting) {
      window.clearInterval(waitIntervalRef.current);
      waitIntervalRef.current = null;
      waitStartRef.current = 0;
      setWaitSeconds(0);
      return;
    }

    if (waitIntervalRef.current) return;
    waitStartRef.current = Date.now();
    setWaitSeconds(0);
    waitIntervalRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - waitStartRef.current) / 1000);
      setWaitSeconds(elapsed);
    }, 1000);

    return () => {
      window.clearInterval(waitIntervalRef.current);
      waitIntervalRef.current = null;
    };
  }, [isWaiting]);

  const clearFocus = useCallback(() => {
    if (loading) return;
    setSelectedCatalogUrl("");
    setSelectedImage(null);
    setResultImageUrl("");
    setResultMeta(null);
    setRefinedForKey("");
    setTextureOptions([]);
    setSelectedTextureOptionId("");
    refineAbortRef.current?.abort();
    setRefineLoading(false);
    setStatusText("");
    setError("");
    dismissTopNotice();
  }, [loading, dismissTopNotice]);

  useEffect(() => {
    if (!isFocused || loading || isResultView) return;
    const t = window.setTimeout(() => promptRef.current?.focus(), 320);
    return () => window.clearTimeout(t);
  }, [isFocused, loading, isResultView, selectedCatalogUrl]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && isFocused && !loading) clearFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFocused, loading, clearFocus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/images/original");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "이미지 목록 로드 실패");
        if (!cancelled) setCatalogImages(Array.isArray(data.images) ? data.images : []);
      } catch (e) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const yearStats = useMemo(() => {
    const years = [];
    for (const url of catalogImages) {
      const y = parseCoverYear(url);
      if (y) years.push(y);
    }
    if (!years.length) return { min: 1976, max: 1982, years: [] };
    const uniq = [...new Set(years)].sort((a, b) => a - b);
    return { min: uniq[0], max: uniq[uniq.length - 1], years: uniq };
  }, [catalogImages]);

  const filteredCatalog = useMemo(() => {
    if (filterYear == null) return catalogImages;
    return catalogImages.filter((url) => parseCoverYear(url) === filterYear);
  }, [catalogImages, filterYear]);

  const handleCatalogSelect = async (publicUrl) => {
    if (loading || imageLoading) return;
    setImageLoading(true);
    setError("");
    setSelectedCatalogUrl(publicUrl);
    setResultImageUrl("");
    setResultMeta(null);
    setRefinedForKey("");
    setTextureOptions([]);
    setSelectedTextureOptionId("");
    try {
      const base64 = await urlToBase64(publicUrl);
      setSelectedImage(base64);
    } catch (err) {
      console.error(err);
      setSelectedCatalogUrl("");
      setSelectedImage(null);
      setError(String(err?.message || err));
    } finally {
      setImageLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      window.clearTimeout(noticeTimerRef.current);
      refineAbortRef.current?.abort();
    };
  }, []);

  const handlePromptChange = (e) => {
    const next = e.target.value;
    setUserPrompt(next);
    const trimmed = next.trim();
    if (refinedForKey && trimmed !== refinedForKey) {
      setRefinedForKey("");
      setTextureOptions([]);
      setSelectedTextureOptionId("");
    }
  };

  const applyStylePreset = (snippet) => {
    if (loading || refineLoading) return;
    const text = String(snippet || "").trim();
    if (!text) return;
    setUserPrompt((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return text;
      if (trimmed.includes(text)) return trimmed;
      return `${trimmed}, ${text}`;
    });
    setRefinedForKey("");
    setTextureOptions([]);
    setSelectedTextureOptionId("");
  };

  const runTranslate = useCallback(async () => {
    const trimmed = userPrompt.trim();
    if (!trimmed || refineLoading || loading) return;

    refineAbortRef.current?.abort();
    const controller = new AbortController();
    refineAbortRef.current = controller;
    const { signal } = controller;

    setRefineLoading(true);
    setRefinedForKey("");
    setTextureOptions([]);
    setSelectedTextureOptionId("");
    setError("");

    try {
      const texRes = await fetch("/api/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({ prompt: trimmed, purpose: "texture" })
      });
      const texData = await texRes.json().catch(() => ({}));
      if (!texRes.ok) throw new Error(texData?.error || "텍스처 프롬프트 번역 실패");
      const options = Array.isArray(texData?.options) ? texData.options.filter(Boolean) : [];
      const texturePromptEn = String(texData.refinedPrompt || "").trim();
      if (!texturePromptEn) throw new Error("텍스처 영어 프롬프트가 비어 있습니다.");

      if (signal.aborted) return;
      if (options.length) {
        setTextureOptions(
          options.map((o, i) => ({
            id: String(o?.id || `opt${i + 1}`),
            label: String(o?.label || `옵션 ${i + 1}`),
            text: String(o?.text || "").trim()
          }))
        );
        setSelectedTextureOptionId(String(options[0]?.id || "opt1"));
      } else {
        setTextureOptions([{ id: "main", label: "입력 번역", text: texturePromptEn }]);
        setSelectedTextureOptionId("main");
      }
      setRefinedForKey(trimmed);
    } catch (e) {
      if (signal.aborted) return;
      showTopNotice(String(e?.message || e));
    } finally {
      if (!signal.aborted) setRefineLoading(false);
    }
  }, [userPrompt, refineLoading, loading, showTopNotice]);

  const selectedTextureEn = useMemo(() => {
    const opt = textureOptions.find((o) => o.id === selectedTextureOptionId);
    return String(opt?.text || "").trim();
  }, [textureOptions, selectedTextureOptionId]);

  const refineReady = useMemo(() => {
    const trimmed = userPrompt.trim();
    if (!trimmed || refineLoading) return false;
    if (refinedForKey !== trimmed) return false;
    if (!textureOptions.length || !selectedTextureOptionId) return false;
    return Boolean(selectedTextureEn);
  }, [userPrompt, refineLoading, refinedForKey, textureOptions, selectedTextureOptionId, selectedTextureEn]);

  const go = useCallback(async () => {
    if (loading) return;
    if (!selectedImage) {
      setError("이미지를 선택해 주세요.");
      return;
    }
    if (!userPrompt.trim()) {
      setError("프롬프트를 입력해 주세요.");
      return;
    }
    if (!refineReady) {
      setError(refineLoading ? "번역이 완료될 때까지 기다려 주세요." : "번역 버튼을 눌러 주세요.");
      return;
    }

    const texturePromptEn = selectedTextureEn;
    const imageName = selectedCatalogUrl ? selectedCatalogUrl.split("/").pop() : "";

    setLoading(true);
    setError("");
    dismissTopNotice();
    setStatusText("");
    setResultImageUrl("");
    setResultMeta(null);
    setRunpodInfo(null);
    runpodInfoRef.current = "";

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      setStatusText("이미지 업로드 중…");
      let imageUrl = "";
      if (String(selectedImage).startsWith("data:")) {
        const upRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal,
          body: JSON.stringify({ dataUrl: selectedImage, filename: imageName, folder: "covers" })
        });
        const upData = await upRes.json().catch(() => ({}));
        if (!upRes.ok) throw new Error(upData?.detail || upData?.error || "이미지 업로드 실패");
        imageUrl = String(upData?.url || "").trim();
        if (!imageUrl) throw new Error("업로드 URL을 받지 못했습니다.");
      } else {
        imageUrl = String(selectedImage);
      }

      setStatusText("RunPod 전송 중…");
      const runRes = await fetch("/api/runpod/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          mode: RUNPOD_PIPELINE_MODE,
          texturePrompt: texturePromptEn,
          imageUrl,
          imageName
        })
      });
      const runData = await runRes.json().catch(() => ({}));
      if (!runRes.ok) throw new Error(runData?.detail || runData?.error || "RunPod 제출 실패");

      const jobId = String(runData?.id || "").trim();
      if (!jobId) throw new Error("RunPod job id를 받지 못했습니다.");

      setStatusText("ComfyUI 생성 대기 중…");
      const deadline = Date.now() + TIMEOUT_MS;
      while (Date.now() < deadline) {
        const stRes = await fetch(`/api/runpod/status/${encodeURIComponent(jobId)}`, { signal });
        const stData = await stRes.json().catch(() => ({}));
        if (!stRes.ok) throw new Error(stData?.detail || stData?.error || "상태 조회 실패");

        const jobStatus = String(stData?.status || "").toUpperCase();
        const nextInfo = JSON.stringify({
          jobStatus,
          delayTime: stData?.delayTime ?? null,
          executionTime: stData?.executionTime ?? null,
          workerId: stData?.workerId ?? null
        });
        if (runpodInfoRef.current !== nextInfo) {
          runpodInfoRef.current = nextInfo;
          setRunpodInfo(JSON.parse(nextInfo));
        }
        if (jobStatus === "COMPLETED") {
          const imgs = Array.isArray(stData?.images) ? stData.images.filter(Boolean) : [];
          if (!imgs.length) throw new Error("완료됐지만 이미지가 응답에 없습니다.");
          const sourceName = selectedCatalogUrl ? selectedCatalogUrl.split("/").pop() : "";
          const generationSeconds = waitStartRef.current
            ? Math.max(0, Math.floor((Date.now() - waitStartRef.current) / 1000))
            : 0;
          setResultMeta({
            sourceName,
            sourceYear: parseCoverYear(selectedCatalogUrl),
            userPrompt: userPrompt.trim(),
            refinedTexturePrompt: texturePromptEn,
            textureOptionLabel:
              textureOptions.find((o) => o.id === selectedTextureOptionId)?.label || "",
            pipelineLabel: PIPELINE_RESULT_LABEL,
            generationSeconds
          });
          setResultImageUrl(String(imgs[0]));
          setStatusText("완료");
          setLoading(false);
          return;
        }

        if (jobStatus === "FAILED" || jobStatus === "CANCELLED" || jobStatus === "TIMED_OUT") {
          throw new Error(stData?.error ? String(stData.error) : jobStatus);
        }

        await sleep(POLL_MS);
      }

      throw new Error("생성 시간이 초과되었습니다. (RunPod 대기열이 길 수 있습니다)");
    } catch (e) {
      if (signal.aborted) return;
      const msg = String(e?.message || e);
      showTopNotice(`Comfy / RunPod: ${msg}`);
      setStatusText("");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [
    loading,
    userPrompt,
    selectedImage,
    selectedCatalogUrl,
    refineReady,
    refineLoading,
    selectedTextureEn,
    selectedTextureOptionId,
    textureOptions,
    dismissTopNotice,
    showTopNotice
  ]);

  const selectedName = selectedCatalogUrl ? selectedCatalogUrl.split("/").pop() : "";
  const selectedTitle = formatCoverTitle(selectedName);
  const heroSrc = isResultView ? "" : selectedCatalogUrl;

  const yearSliderIndex = useMemo(() => {
    if (filterYear == null || !yearStats.years.length) return 0;
    const idx = yearStats.years.indexOf(filterYear);
    return idx >= 0 ? idx : yearStats.years.length - 1;
  }, [filterYear, yearStats.years]);

  const handleYearSlider = (e) => {
    const idx = Number(e.target.value);
    const y = yearStats.years[idx];
    if (y) setFilterYear(y);
  };

  return (
    <main className={`${styles.page} ${isFocused ? styles.pageFocused : ""} ${isResultView ? styles.pageResult : ""}`}>
      {topNotice ? (
        <div
          className={`${styles.topNotice} ${
            topNotice.variant === "info" ? styles.topNoticeInfo : styles.topNoticeError
          }`}
          role="alert"
        >
          <p className={styles.topNoticeText}>{topNotice.message}</p>
          <button type="button" className={styles.topNoticeClose} onClick={dismissTopNotice} aria-label="닫기">
            ×
          </button>
        </div>
      ) : null}
      <section className={styles.stage} aria-live="polite">
        <div className={styles.galleryShell}>
          <div className={styles.galleryBackdrop}>
            <div className={styles.yearBar}>
            <button
              type="button"
              className={`${styles.yearAllBtn} ${filterYear == null ? styles.yearAllBtnActive : ""}`}
              onClick={() => setFilterYear(null)}
              disabled={catalogLoading || loading}
            >
              전체
            </button>
            <div className={styles.yearLeverWrap}>
              <span className={styles.yearEdge}>{yearStats.min}</span>
              <input
                type="range"
                className={styles.yearLever}
                min={0}
                max={Math.max(0, yearStats.years.length - 1)}
                step={1}
                value={yearSliderIndex}
                onChange={handleYearSlider}
                disabled={catalogLoading || loading || !yearStats.years.length}
                aria-label="연도 선택"
              />
              <span className={styles.yearEdge}>{yearStats.max}</span>
            </div>
            <p className={styles.yearCaption}>
              {filterYear == null ? "전체 연도" : `${filterYear}년`} · {filteredCatalog.length}표지
            </p>
          </div>
          <div className={styles.imageGrid}>
            {filteredCatalog.map((url) => (
              <button
                key={url}
                type="button"
                className={`${styles.gridTile} ${selectedCatalogUrl === url ? styles.active : ""}`}
                onClick={() => handleCatalogSelect(url)}
                disabled={loading || imageLoading}
                title={formatCoverTitle(url)}
              >
                <img src={url} className={styles.gridImg} alt="" loading="lazy" />
              </button>
            ))}
          </div>
          </div>
        </div>

        {isFocused ? (
          <>
            {isResultView ? (
              <div className={styles.resultCanvas} aria-hidden />
            ) : (
              <button
                type="button"
                className={styles.focusScrim}
                aria-label="선택 닫기"
                onClick={clearFocus}
                disabled={loading}
              />
            )}
            <div className={styles.focusHero} aria-hidden={false}>
              {isResultView ? (
                <div key={resultImageUrl} className={`${styles.resultHeroFrame} ${styles.focusHeroSpring}`}>
                  <img
                    className={styles.resultHeroImg}
                    src={resultImageUrl}
                    alt="생성 결과"
                    decoding="async"
                    draggable={false}
                  />
                </div>
              ) : heroSrc ? (
                <div key={selectedCatalogUrl} className={`${styles.focusHeroFrame} ${styles.focusHeroSpring}`}>
                  <img
                    className={styles.focusHeroImg}
                    src={heroSrc}
                    alt={selectedTitle || "선택한 표지"}
                    width={200}
                    height={270}
                    decoding="async"
                    draggable={false}
                  />
                </div>
              ) : null}
              {imageLoading ? <span className={styles.heroLoading}>불러오는 중…</span> : null}
              {loading && !isResultView ? (
                <div className={`${styles.heroLoading} ${styles.heroLoadingStack}`}>
                  <span>{statusText || "생성 중…"}</span>
                  {isWaiting ? (
                    <span className={styles.waitCounter}>경과 {formatElapsed(waitSeconds)}</span>
                  ) : null}
                  {runpodInfo?.jobStatus ? (
                    <span className={styles.waitCounter}>RunPod 상태: {runpodInfo.jobStatus}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <aside className={`${styles.rightPanel} ${isResultView ? styles.rightPanelResult : ""}`}>
              <button type="button" className={styles.closeFocusBtn} onClick={clearFocus} disabled={loading}>
                닫기 (Esc)
              </button>

              {isResultView && resultMeta ? (
                <>
                  <div className={styles.sidebarBlock}>
                    <p className={styles.sidebarLabel}>생성 완료</p>
                    <p className={styles.resultLead}>
                      <strong>{formatCoverTitle(resultMeta.sourceName) || "표지"}</strong>
                      에 선택한 텍스처를 결합했습니다.
                    </p>
                    <dl className={styles.resultSummary}>
                      <div className={styles.resultRow}>
                        <dt>원본 표지</dt>
                        <dd>{formatCoverTitle(resultMeta.sourceName) || "—"}</dd>
                      </div>
                      {resultMeta.sourceYear ? (
                        <div className={styles.resultRow}>
                          <dt>연도</dt>
                          <dd>{resultMeta.sourceYear}</dd>
                        </div>
                      ) : null}
                      <div className={styles.resultRow}>
                        <dt>파이프라인</dt>
                        <dd>{resultMeta.pipelineLabel}</dd>
                      </div>
                      {typeof resultMeta.generationSeconds === "number" ? (
                        <div className={styles.resultRow}>
                          <dt>소요 시간</dt>
                          <dd>{formatElapsed(resultMeta.generationSeconds)}</dd>
                        </div>
                      ) : null}
                      <div className={styles.resultRow}>
                        <dt>텍스처 요청 (한글)</dt>
                        <dd>{resultMeta.userPrompt || "—"}</dd>
                      </div>
                      <div className={styles.resultRow}>
                        <dt>적용 텍스처 (EN)</dt>
                        <dd>{resultMeta.refinedTexturePrompt || "—"}</dd>
                      </div>
                      {resultMeta.textureOptionLabel ? (
                        <div className={styles.resultRow}>
                          <dt>선택 옵션</dt>
                          <dd>{resultMeta.textureOptionLabel}</dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                  <button type="button" className={styles.backEditBtn} onClick={clearResult} disabled={loading}>
                    다시 편집
                  </button>
                </>
              ) : (
                <>
              {selectedName ? <p className={styles.metaLine}>{selectedTitle}</p> : null}

              <div className={styles.sidebarBlock}>
                <p className={styles.pipelineIntro}>텍스처(나무, 강철, 잔디 등)를 입력해 원본 표지에 결합해 보세요.</p>
                <p className={styles.presetLabel}>텍스처 프리셋</p>
                <div className={styles.guideRow}>
                  {STYLE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={styles.guideBtn}
                      onClick={() => applyStylePreset(preset.text)}
                      disabled={loading || refineLoading}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={promptRef}
                  className={styles.textInputCompact}
                  rows={4}
                  placeholder="텍스처 설명 (한글)"
                  value={userPrompt}
                  onChange={handlePromptChange}
                  disabled={loading || refineLoading}
                />
                <button
                  type="button"
                  className={styles.translateBtn}
                  onClick={runTranslate}
                  disabled={loading || refineLoading || !userPrompt.trim()}
                >
                  {refineLoading ? "번역 중…" : "번역"}
                </button>
                {textureOptions.length ? (
                  <div className={styles.textureOptionsBlock}>
                    <p className={styles.refinedTitle}>EN · 적용할 텍스처 선택</p>
                    <div className={styles.guideRow}>
                      {textureOptions.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          className={`${styles.guideBtn} ${styles.textureOptionBtn} ${
                            selectedTextureOptionId === opt.id ? styles.textureOptionBtnActive : ""
                          }`}
                          onClick={() => setSelectedTextureOptionId(opt.id)}
                          disabled={loading || refineLoading}
                          title={opt.text}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {selectedTextureEn ? (
                      <p className={styles.textureOptionPreview}>{selectedTextureEn}</p>
                    ) : null}
                  </div>
                ) : null}
                <button
                  className={styles.goBtn}
                  type="button"
                  onClick={go}
                  disabled={loading || imageLoading || refineLoading || !selectedImage || !refineReady}
                >
                  Generate
                </button>
              </div>

              {statusText ? <p className={styles.status}>{statusText}</p> : null}
              {error ? <p className={styles.error}>{error}</p> : null}
                </>
              )}
            </aside>
          </>
        ) : null}
      </section>
    </main>
  );
}
