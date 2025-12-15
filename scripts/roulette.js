import { world, system } from "@minecraft/server";

// --- 設定 ---
const CONFIG = {
    winRate: 0, // 当たり確率（パーセント: 0 ~ 100）
    
    // 表示文字設定
    symbolWin: "§4O§r",  // あたり（黄色）
    symbolLose: "§8X§r",  // はずれ（灰色）
    
    // 演出設定
    scrollSpeed: 2,       // スクロール速度（tick単位。小さいほど速い。2推奨）
    reelLength: 40,       // リール（全体の文字列）の基本長さ
    randomLengthRange: 20,// 追加ランダム長さ（0～この値のフレーム数が追加される）
    viewWidth: 7,         // 表示する幅（奇数推奨）
    
    // サウンド
    soundTick: "random.click",
    soundWin: "random.levelup",
    soundLose: "random.break",

    // 結果時の実行コマンド（空文字 "" なら何もしない）
    // @s は実行プレイヤーになります
    commandWin: "give @s diamond 1", 
    commandLose: "",
};

// ルーレット実行フラグ用プロパティ
const ROULETTE_PLAYING_PROP = "mss:roulette_playing";

/**
 * ルーレットシステムクラス
 */
export class RouletteSystem {

    /**
     * ルーレットを開始します。
     * @param {import("@minecraft/server").Player} player 
     */
    static start(player) {
        // 多重実行防止

        // 実行中フラグON
        player.setDynamicProperty(ROULETTE_PLAYING_PROP, true);

        // 1. 抽選
        const isWin = (Math.random() * 100) < CONFIG.winRate;

        // 2. リール長の決定（ランダム性を追加）
        const randomAdded = Math.floor(Math.random() * (CONFIG.randomLengthRange + 1));
        const totalLength = CONFIG.reelLength + randomAdded;

        // 3. リール（文字列配列）の生成
        const reel = this.generateReel(isWin, totalLength);

        // 4. アニメーション開始
        this.playAnimation(player, reel, isWin, () => {
            // 完了時のコールバック（フラグ解除）
        });
    }

    /**
     * リールを生成します。
     * @param {boolean} isWin 結果が当たりかどうか
     * @param {number} totalLength リールの総長
     * @returns {string[]} シンボルの配列
     */
    static generateReel(isWin, totalLength) {
        const reel = [];
        const centerIndex = Math.floor(CONFIG.viewWidth / 2);
        
        // 最終的な停止位置（リールの最後の方）
        // 表示ウィンドウの中央に結果が来るように調整
        // アニメーションは index 0 から始まり、(totalLength - viewWidth) まで進む
        // 最後のフレームでウィンドウの中央（centerIndex）に来る要素が「結果」
        
        // 生成
        for (let i = 0; i < totalLength; i++) {
            // ランダムに配置
            const isSymbolWin = Math.random() < 0.5;
            reel.push(isSymbolWin ? CONFIG.symbolWin : CONFIG.symbolLose);
        }

        // 結果を確定させる位置を書き換える
        // 最後の表示フレームの開始インデックス
        const finalFrameStartIndex = totalLength - CONFIG.viewWidth;
        // そのフレームの中央インデックス
        const resultIndex = finalFrameStartIndex + centerIndex;

        reel[resultIndex] = isWin ? CONFIG.symbolWin : CONFIG.symbolLose;

        return reel;
    }

    /**
     * アニメーションを再生します。
     * @param {import("@minecraft/server").Player} player 
     * @param {string[]} reel 
     * @param {boolean} isWin 
     * @param {() => void} [onComplete]
     */
    static playAnimation(player, reel, isWin, onComplete) {
        let currentFrame = 0;
        const maxFrames = reel.length - CONFIG.viewWidth;
        const centerOffset = Math.floor(CONFIG.viewWidth / 2);

        // アニメーションループ関数
        const loop = () => {
            if (!player.isValid()) {
                if (onComplete) onComplete();
                return;
            }

            // 現在の表示部分を切り出し
            const viewSlice = reel.slice(currentFrame, currentFrame + CONFIG.viewWidth);
            
            // 表示用文字列の構築
            // 中央（centerOffset）の要素だけ [] で囲む
            // 最後のフレーム（停止時）は括弧の色を黄色に変える
            const isLastFrame = currentFrame === maxFrames;
            const bracketColor = isLastFrame ? "§e" : "§f";

            const displayParts = viewSlice.map((symbol, index) => {
                if (index === centerOffset) {
                    return `${bracketColor}[§r ${symbol} ${bracketColor}]§r`; // 強調表示
                }
                return "  " + symbol + "  "; // 他はスペースで調整（幅を合わせるため）
            });
            const displayString = displayParts.join("");
            
            player.onScreenDisplay.setTitle(displayString, {
                fadeInDuration: 0,
                stayDuration: 20, 
                fadeOutDuration: 0,
            });
            player.onScreenDisplay.updateSubtitle("");

            // 音を鳴らす
            player.playSound(CONFIG.soundTick, { pitch: 1.0 }); 

            // 次のフレームへ
            currentFrame++;

            // 終了判定
            if (currentFrame > maxFrames) {
                this.showResult(player, isWin, onComplete);
            } else {
                // 次のフレームまでの遅延を計算（だんだん遅くする）
                const progress = currentFrame / maxFrames;
                const baseDelay = CONFIG.scrollSpeed; 
                const addedDelay = 8 * (progress * progress * progress); // 終盤にグッと遅くする
                const delay = Math.max(1, Math.floor(baseDelay + addedDelay));

                system.runTimeout(loop, delay);
            }
        };

        // 初回実行
        loop();
    }

    /**
     * 結果を表示します。
     * @param {import("@minecraft/server").Player} player 
     * @param {boolean} isWin 
     * @param {() => void} [onComplete]
     */
    static showResult(player, isWin, onComplete) {
        // 少し待ってから結果発表
        system.runTimeout(() => {
            if (!player.isValid()) {
                if (onComplete) onComplete();
                return;
            }

            const title = isWin ? "§6§lあたり！" : "§8§lはずれ...";
            const subtitle = isWin ? "§eおめでとうございます！" : "§7残念...";
            
            player.onScreenDisplay.setTitle(title, {
                fadeInDuration: 2,
                stayDuration: 60,
                fadeOutDuration: 10
            });
            player.onScreenDisplay.updateSubtitle(subtitle);

            if (isWin) {
                player.playSound(CONFIG.soundWin);
                player.dimension.spawnEntity("minecraft:fireworks_rocket", player.location);
                
                // 当たりコマンド実行
                if (CONFIG.commandWin) {
                    try {
                        player.runCommandAsync(CONFIG.commandWin);
                    } catch (e) {
                        console.error(`[RouletteSystem] Win command error: ${e}`);
                    }
                }
            } else {
                player.playSound(CONFIG.soundLose);

                // はずれコマンド実行
                if (CONFIG.commandLose) {
                    try {
                        player.runCommandAsync(CONFIG.commandLose);
                    } catch (e) {
                        console.error(`[RouletteSystem] Lose command error: ${e}`);
                    }
                }
            }

            // 演出終了後にコールバック実行
            if (onComplete) {
                // 結果表示の時間を考慮して少し待ってから完了とする
                system.runTimeout(onComplete, 60);
            }

        }, 15); // ルーレット停止から少し間を置く
    }
}