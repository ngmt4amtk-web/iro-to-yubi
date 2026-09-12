# いろとゆび

公開先: https://ngmt4amtk-web.github.io/iro-to-yubi/

バイオリンのラ弦（赤）とミ弦（緑）の0〜3を見て弾くアプリ。

## 今回の仕様

- 赤：ラ・シ・ド♯・レ。緑：ミ・ファ♯・ソ♯・ラ。基準A=440Hz。
- ふよみの既存3キャラを事前選択。画像は変更せず再利用。
- 1フレーズ4音。1・3・5フレーズを選ぶ。
- 各音への切り替えでキャラが登場。正解でジャンプと紙吹雪。
- 全フレーズ終了時に大きなキャラと紙吹雪。全音正解なら「ぜんぶ できた！」、それ以外は「さいごまで できた！」。
- タイムバーと残り秒表示は非表示。
- 正解後850msの演出で次へ。無音では待機。間違い検出時にお手本を1回鳴らし、その検出から4秒後に次へ。待機中の弾き直しが正解なら通常の正解演出で進む。
- ピッチ判定は半音以内とオクターブ違いを許容。150セントより大きな違いが600ms続くとお手本。曖昧な中間帯は保留。
- お手本の再生後までマイク判定を止め、自分の音を正解に数えない。
- 休憩・画面非表示・終了でマイク停止。再開時は現在の音から判定し直す。
- 外部依存なし。音声はブラウザ内で処理し、保存・送信しない。

## 検証記録 2026-09-12

`node --test verify.mjs`：8テスト合格。8音×2サンプルレート×3音程差×2倍音構成＝96合成音を確認。無音・一定値・ノイズ・短い誤音・倍音推定・訂正後の正解・誤判定から4秒・4/12/20音終了を検証。

JavaScript構文、HTML内ID、参照CSS・キャラ画像の存在、保存後の再読を確認。キャラ元画像3枚を目視。

実バイオリン、実機マイク、iPhone上の音量・発音・表示は未検証。ブラウザでの操作試験は未実施。WebMCPは対応環境が使えないため登録と呼び出し未検証。

参照したブラウザAPI資料：

- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume
- https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData

## GitHub Pages更新

mainにソースを保存し、`git subtree push --prefix dist origin gh-pages` で公開用ブランチを更新。Pagesは gh-pages のルートを使用。
