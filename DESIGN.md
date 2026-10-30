---
name: Chocomint Research OS
description: 읽기와 다음 행동을 돕는 개인 연구 작업실
colors:
  paper: "#ffffff"
  ink: "#1e2935"
  muted: "#536476"
  accent: "#315f9b"
  accent-hover: "#254c80"
  line: "#dce3eb"
  paper-raised: "#fafbfd"
  paper-muted: "#f1f4f8"
  ink-soft: "#536476"
  line-strong: "#b7c5d3"
  accent-soft: "#edf3fa"
  success: "#54826d"
  warning: "#9a7451"
  danger: "#b65c56"
  chrome-raised: "#edf3fa"
  chrome-line: "#dce3eb"
  chrome-text: "#1e2935"
  chrome-muted: "#536476"
typography:
  body:
    fontFamily: '"Noto Sans KR", system-ui, sans-serif'
    fontSize: "15px"
    lineHeight: 1.5
  caption:
    fontSize: "12px"
  helper:
    fontSize: "13px"
  compact-body:
    fontSize: "14px"
  control:
    fontSize: "16px"
  card-title:
    fontSize: "18px"
  status:
    fontSize: "20px"
  mobile-title:
    fontSize: "21px"
  large-status:
    fontSize: "22px"
  project-title:
    fontSize: "24px"
  page-title:
    fontSize: "27px"
  heading:
    fontSize: "28px"
rounded:
  panel: "14px"
  control: "8px"
  input: "10px"
  disclosure: "12px"
spacing:
  section: "24px"
  page: "32px"
---

# Design System: Chocomint Research OS

## Overview

確定した Cool Minimal の白・青みのあるグレー・青を全画面の共通基盤とし、読みやすさと作業上の優先順位を表現の中心に置く。対象モードは Operate / Read。

## Colors

実装のトークン定義は `app/chocomint-theme.css` に集約する。`--accent` は青の `--blue-strong` を参照する。背景・境界・補助文字・危険・注意は意味ごとの変数を使う。

## Typography

本文15px、補助情報12–13px、モバイル入力16px。研究本文は14–16px、最大72ch程度の読み幅とする。新しい研究概要はタイトル24px、見出し16px、本文15px。古い個別画面には小さい固定サイズが残るため、全画面の移行完了を意味しない。

## Layout

共通の既存間隔6/10/14/18pxを保持し、セクション24px・ページ区切り32pxを使う。ホームは期限・今日の作業を先に置き、補助的な点検は disclosure にまとめる。研究は質問・現在判断・根拠・次の行動を順に配置する。小さい画面では既存の下部ナビゲーションを使う。

## Elevation & Depth

通常パネルは境界線で区切り、影を使わない。研究概要は面と区切り線でまとめ、カードの入れ子を増やさない。

## Shapes

既存パネル14px、共通コントロール8pxの角丸を維持する。本文領域を必要なくカード化しない。

## Components

研究概要とホームの構成は CSS Modules で局所化する。補助的な管理・接続情報には標準 details/summary を使う。既存の保存・承認・同期処理は変更しない。ボタンのフォーカスを青の輪郭で示し、モバイル共通ボタンは44px以上の高さを確保する。

## Do's and Don'ts

- Do: 判断は同じ sourcePath の原文から表示し、出典を添える。
- Do: 未取得・未接続を0件や検証済みと表示しない。
- Don't: CSSの上書きを増やして旧ルールとの衝突を隠さない。
- Don't: データや研究上の判断を見栄えのために作らない。
