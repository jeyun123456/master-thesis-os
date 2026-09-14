'use client';

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import styles from '@/app/reward-slot.module.css';

type Reward = {
  icon: string;
  label: string;
  weight: number;
};

type RewardHistory = {
  label: string;
  icon: string;
  at: string;
};

type RewardState = {
  completionDate: string;
  completedTasks: string[];
  credits: number;
  history: RewardHistory[];
};

type RewardSlotPanelProps = {
  tasks: string[];
  projectTitle: string;
  onNotice?: (message: string) => void;
};

const STORAGE_KEY = 'masterThesisOS.rewardSlot.v1';
const DEFAULT_SLOT_CREDITS = 100;
const LEVER_PULL_DURATION_MS = 520;
const SPIN_DURATION_MS = 1500;
const REEL_STOP_GAP_MS = 500;
const REEL_TICK_MS = 85;
const LEVER_PULL_DISTANCE = 130;
const LEVER_MAX_TRAVEL = 125;
const LEVER_PULL_THRESHOLD = 0.7;

const rewards: Reward[] = [
  { icon: '🎮', label: '게임 30분', weight: 24 },
  { icon: '📺', label: '유튜브 20분', weight: 20 },
  { icon: '☕', label: '간식 / 카페', weight: 16 },
  { icon: '🛋️', label: '아무것도 안 하기 20분', weight: 18 },
  { icon: '🎲', label: '자유시간 30분', weight: 17 },
  { icon: '⭐', label: '자유시간 60분', weight: 5 },
];

function seoulDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function emptyState(): RewardState {
  return {
    completionDate: seoulDateKey(),
    completedTasks: [],
    credits: DEFAULT_SLOT_CREDITS,
    history: [],
  };
}

function loadState(): RewardState {
  const today = seoulDateKey();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<RewardState>;
    const sameDay = parsed.completionDate === today;
    return {
      completionDate: today,
      completedTasks: sameDay && Array.isArray(parsed.completedTasks)
        ? parsed.completedTasks.filter((item): item is string => typeof item === 'string')
        : [],
      credits: typeof parsed.credits === 'number' && Number.isFinite(parsed.credits)
        ? Math.max(0, Math.floor(parsed.credits))
        : 0,
      history: Array.isArray(parsed.history)
        ? parsed.history.filter((item): item is RewardHistory => Boolean(item && typeof item.label === 'string' && typeof item.icon === 'string' && typeof item.at === 'string')).slice(0, 5)
        : [],
    };
  } catch {
    return emptyState();
  }
}

function pickReward() {
  const totalWeight = rewards.reduce((sum, reward) => sum + reward.weight, 0);
  let cursor = Math.random() * totalWeight;
  for (const reward of rewards) {
    cursor -= reward.weight;
    if (cursor < 0) return reward;
  }
  return rewards[rewards.length - 1];
}

function randomIcon() {
  return rewards[Math.floor(Math.random() * rewards.length)].icon;
}

function reelSymbols(current: string, reelIndex: number) {
  return [
    current,
    rewards[(reelIndex + 1) % rewards.length].icon,
    rewards[(reelIndex + 3) % rewards.length].icon,
    rewards[(reelIndex + 5) % rewards.length].icon,
    rewards[(reelIndex + 2) % rewards.length].icon,
  ];
}

export function RewardSlotPanel({ tasks, projectTitle, onNotice }: RewardSlotPanelProps) {
  const [state, setState] = useState<RewardState>(emptyState);
  const [ready, setReady] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [leverPulling, setLeverPulling] = useState(false);
  const [leverDragging, setLeverDragging] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const [reels, setReels] = useState(['🎲', '🎲', '🎲']);
  const [stoppedReels, setStoppedReels] = useState([false, false, false]);
  const [result, setResult] = useState('');
  const intervalRef = useRef<number | null>(null);
  const leverTimersRef = useRef<number[]>([]);
  const reelStopTimersRef = useRef<number[]>([]);
  const leverButtonRef = useRef<HTMLButtonElement | null>(null);
  const dragStartYRef = useRef(0);
  const pullProgressRef = useRef(0);
  const leverPointerIdRef = useRef<number | null>(null);
  const spinningRef = useRef(false);

  useEffect(() => {
    setState(loadState());
    setReady(true);
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      leverTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      reelStopTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Embedded wallpaper runtimes can deny storage. The slot still works
      // for the current session even when persistence is unavailable.
    }
  }, [ready, state]);

  function completeTask(task: string) {
    if (!ready || state.completedTasks.includes(task)) return;
    setState((current) => ({
      ...current,
      completedTasks: [...current.completedTasks, task],
      credits: current.credits + 1,
    }));
    onNotice?.('작업 완료 · 슬롯 1회 충전!');
  }

  function spin() {
    if (!ready || state.credits < 1 || spinningRef.current) return;
    spinningRef.current = true;
    setLeverPulling(true);
    setStoppedReels([false, false, false]);
    setSpinning(false);
    setResult('');
    setState((current) => ({ ...current, credits: Math.max(0, current.credits - 1) }));

    const startReels = window.setTimeout(() => {
      leverTimersRef.current = [];
      setLeverPulling(false);
      setSpinning(true);
      const activeReels = [true, true, true];
      const reward = pickReward();
      intervalRef.current = window.setInterval(() => {
        setReels((current) => current.map((reel, index) => activeReels[index] ? randomIcon() : reel));
      }, REEL_TICK_MS);

      const stopReel = (reelIndex: number) => {
        activeReels[reelIndex] = false;
        setReels((current) => current.map((reel, index) => index === reelIndex ? reward.icon : reel));
        setStoppedReels(activeReels.map((active) => !active));
        if (reelIndex !== activeReels.length - 1) return;
        if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
        intervalRef.current = null;
        setReels([reward.icon, reward.icon, reward.icon]);
        setResult(`${reward.icon} ${reward.label}`);
        setState((current) => ({
          ...current,
          history: [{ label: reward.label, icon: reward.icon, at: new Date().toISOString() }, ...current.history].slice(0, 5),
        }));
        spinningRef.current = false;
        setSpinning(false);
        onNotice?.(`당첨 · ${reward.label}`);
      };

      reelStopTimersRef.current = activeReels.map((_, reelIndex) => window.setTimeout(
        () => stopReel(reelIndex),
        SPIN_DURATION_MS + reelIndex * REEL_STOP_GAP_MS,
      ));
    }, LEVER_PULL_DURATION_MS);

    leverTimersRef.current = [startReels];
  }

  function handleLeverPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!ready || spinning || leverPulling || spinningRef.current || state.credits < 1) return;
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;

    event.preventDefault();
    dragStartYRef.current = event.clientY;
    pullProgressRef.current = 0;
    leverPointerIdRef.current = event.pointerId;
    setPullProgress(0);
    setLeverDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleLeverPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!leverDragging || leverPointerIdRef.current !== event.pointerId) return;
    const progress = Math.max(0, Math.min(1, (event.clientY - dragStartYRef.current) / LEVER_PULL_DISTANCE));
    pullProgressRef.current = progress;
    setPullProgress(progress);
  }

  function releaseLeverPointer(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    if (leverPointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const shouldSpin = !cancelled && pullProgressRef.current >= LEVER_PULL_THRESHOLD;
    leverPointerIdRef.current = null;
    pullProgressRef.current = 0;
    setLeverDragging(false);
    setPullProgress(0);
    if (shouldSpin) spin();
  }

  function cancelLeverPull() {
    const pointerId = leverPointerIdRef.current;
    if (pointerId !== null && leverButtonRef.current?.hasPointerCapture(pointerId)) {
      leverButtonRef.current.releasePointerCapture(pointerId);
    }
    leverPointerIdRef.current = null;
    pullProgressRef.current = 0;
    setLeverDragging(false);
    setPullProgress(0);
  }

  const pullOffset = pullProgress * LEVER_MAX_TRAVEL;

  return (
    <div className={styles.slotPage}>
      <div className={`card section ${styles.slotCard}`}>
        <div className={styles.slotHeader}>
          <div>
            <span className={styles.eyebrow}>REWARD DISPENSER</span>
            <h3>작업 보상 슬롯</h3>
            <p>작업을 끝내고 레버를 당기면 오늘의 보상이 나와.</p>
          </div>
          <div className={styles.creditBadge}>
            <span>남은 슬롯</span>
            <b>{ready ? state.credits : 0}<small>회</small></b>
          </div>
        </div>

        <div className={styles.machineStage}>
          <div className={styles.machineGlow} aria-hidden="true" />
          <div className={`${styles.machine} ${spinning ? styles.machineSpinning : ''} ${leverPulling ? styles.machinePulling : ''}`}>
            <div className={styles.machineLabel}>
              <span>MASTER THESIS OS</span>
              <b>REWARD</b>
            </div>
            <div className={styles.lampRow} aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
            </div>
            <div className={styles.reelWindow} aria-label="보상 슬롯 릴">
              {reels.map((reel, index) => (
                <div className={`${styles.reel} ${spinning && !stoppedReels[index] ? styles.spinning : ''} ${stoppedReels[index] ? styles.reelStopped : ''}`} key={index}>
                  <div className={styles.reelCylinder}>
                    {reelSymbols(reel, index).map((symbol, symbolIndex) => (
                      <span className={styles.reelFace} key={`${index}-${symbolIndex}`} aria-hidden="true">{symbol}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.machineBase}>
              <span>ONE TASK</span>
              <b>ONE REWARD</b>
              <span>KEEP GOING</span>
            </div>
          </div>

          <button
            ref={leverButtonRef}
            className={`${styles.leverHousing} ${leverDragging ? styles.leverDragging : ''}`}
            type="button"
            disabled={!ready || spinning || leverPulling || state.credits < 1}
            onPointerDown={handleLeverPointerDown}
            onPointerMove={handleLeverPointerMove}
            onPointerUp={releaseLeverPointer}
            onPointerCancel={(event) => releaseLeverPointer(event, true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && leverDragging) {
                event.preventDefault();
                cancelLeverPull();
              }
            }}
            aria-label="보상 슬롯 레버 당기기"
          >
            <span className={styles.leverRail} aria-hidden="true" />
            <span className={styles.handleXCenter} aria-hidden="true">
              <span className={styles.handleYMove} style={{ transform: `translate3d(0, ${pullOffset}px, 0)` }}>
                <span className={styles.leverHandle}>PULL</span>
              </span>
            </span>
          </button>
        </div>

        <div className={styles.resultArea} aria-live="polite">
          <b>{result || (state.credits > 0 ? '한 번 돌려볼까?' : '작업 하나 끝내면 슬롯이 충전돼.')}</b>
          <small>작업 완료 1개 = 슬롯 1회 · 미사용 슬롯은 유지</small>
        </div>

        {state.history.length > 0 && (
          <div className={styles.history}>
            <span>최근 당첨</span>
            {state.history.slice(0, 3).map((item, index) => <small key={`${item.at}-${index}`}>{item.icon} {item.label}</small>)}
          </div>
        )}
      </div>

      <div className={`card section ${styles.taskCard}`}>
        <div className="head">
          <h3>바로 다음 작업</h3>
          <span>{projectTitle}</span>
        </div>
        {tasks.length ? (
          <div className="numbered-list">
            {tasks.map((task, index) => {
              const completed = state.completedTasks.includes(task);
              return (
                <div className={`numbered-item ${styles.rewardTask} ${completed ? styles.completedTask : ''}`} key={`${index}-${task}`}>
                  <span>{completed ? '✓' : index + 1}</span>
                  <p>{task}</p>
                  <button
                    className={styles.completeButton}
                    type="button"
                    disabled={!ready || completed}
                    onClick={() => completeTask(task)}
                  >
                    {completed ? '완료됨' : '완료 +1'}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty compact-empty">활성 프로젝트의 다음 작업을 표시해.</div>
        )}
        <p className={styles.localHint}>완료 체크는 보상용 로컬 기록이야. 원본 project.md는 바꾸지 않아.</p>
      </div>
    </div>
  );
}
