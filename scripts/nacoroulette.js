import { world, system } from "@minecraft/server";

// --- 設定エリア ---

// 全体の動作設定
const CONFIG = {
    scrollSpeed: 2,       // 基本のスクロール速度（tick）
    baseReelLength: 40,   // リールの基本の長さ
    randomLengthRange: 30,// リールの長さに加えるランダム幅
    viewWidth: 7,         // 表示する幅（奇数を推奨）
    soundTick: "random.click", // 回っているときの音
};

/**
 * シンボル設定テーブル
 * weight: 出現の重み（数字が大きいほど出やすい）
 * display: 画面に表示される文字
 * commands: 当選時に実行されるコマンドのリスト（この中からランダムに1つ実行される）
 * sound: 当選時の効果音
 * title: 当選時に画面に出るタイトル
 * subtitle: 当選時に画面に出るサブタイトル
 */
const SYMBOL_TABLE = [
    {
        id: "secret",
        weight: 0.5, 
        display: "§tS§r",
        commands: [
            "give @s naco:naco_S1 1",
            "give @s naco:naco_S2 1"
        ],
        sound: "random.totem",
        title: "§6§l!!SECRET!!",
        subtitle: "§eシークレット大当たり！"
    },
    {
        id: "HR",
        weight: 3,
        display: "§gHR§r",
        commands: [
            "give @s naco:naco_HR1 1",
            "give @s naco:naco_HR2 1"
        ],
        sound: "random.levelup",
        title: "§gHR",
        subtitle: "§gハイパーレアが当たった！"
    },
    {
        id: "SSR",
        weight: 0,
        display: "§bSSR§r",
        commands: [
            "give @s diamond 1",
            "give @s emerald 5",
            "give @s gold_ingot 10"
        ],
        sound: "random.levelup",
        title: "§bDiamond!",
        subtitle: "SSRが当たった！"
    },
    {
        id: "Rare",
        weight: 26.5,
        display: "§cR§r",
        commands: [
            "give @s naco:naco_R1 1",
            "give @s naco:naco_R2 1",
            "give @s naco:naco_R3 1",
            "give @s naco:naco_R4 1"
        ],
        sound: "random.orb",
        title: "§cR",
        subtitle: "レアが当たった！"
    },
    {
        id: "Normal",
        weight: 70,
        display: "§8N§r",
        commands: [
            "give @s naco:naco_N1 1",
            "give @s naco:naco_N2 1",
            "give @s naco:naco_N3 1",
            "give @s naco:naco_N4 1"
        ],
        sound: "random.break",
        title: "§8N",
        subtitle: "ノーマルが当たった！"
    }
];

// ルーレット実行フラグ用プロパティ
const ROULETTE_PLAYING_PROP = "mss:nacoroulette_playing";

/**
 * ルーレットシステムクラス
 */
export class NacoRoulette {

    /**
     * ルーレットを開始します。
     * @param {import("@minecraft/server").Player} player 
     */
    static start(player) {
        // 実行中フラグON
        player.addTag("nacoroulettePlaying");

        // 1. リール長の決定 (基本長 + ランダム)
        const totalLength = CONFIG.baseReelLength + Math.floor(Math.random() * (CONFIG.randomLengthRange + 1));

        // 2. リール生成 (確率に基づいて並べる)
        const reel = this.generateReel(totalLength);

        // 3. アニメーション開始
        this.playAnimation(player, reel, () => {
            // 完了時の処理
            if (player.isValid()) {
                player.removeTag("nacoroulettePlaying");
            }
        });
    }

    /**
     * 重みに基づいてランダムなシンボルを1つ取得する
     */
    static getRandomSymbol() {
        // 重みの合計を計算
        const totalWeight = SYMBOL_TABLE.reduce((sum, item) => sum + item.weight, 0);
        let random = Math.random() * totalWeight;

        for (const symbol of SYMBOL_TABLE) {
            if (random < symbol.weight) {
                return symbol;
            }
            random -= symbol.weight;
        }
        // フォールバック（通常ここは通りません）
        return SYMBOL_TABLE[SYMBOL_TABLE.length - 1];
    }

    /**
     * リール配列を生成します
     */
    static generateReel(length) {
        const reel = [];
        for (let i = 0; i < length; i++) {
            reel.push(this.getRandomSymbol());
        }
        return reel;
    }

    /**
     * アニメーション制御
     */
    static playAnimation(player, reel, onComplete) {
        let currentFrame = 0;
        // 表示幅の半分（中心オフセット）
        const centerOffset = Math.floor(CONFIG.viewWidth / 2);
        // 最大フレーム数（リールの最後が表示範囲の右端に来るまで）
        const maxFrames = reel.length - CONFIG.viewWidth;

        const loop = () => {
            if (!player.isValid()) {
                if (onComplete) onComplete();
                return;
            }

            // 現在のフレームから表示幅分だけ切り出す
            // 配列の境界を超えないように安全策をとる
            const viewSlice = [];
            for(let i = 0; i < CONFIG.viewWidth; i++) {
                const index = currentFrame + i;
                if (index < reel.length) {
                    viewSlice.push(reel[index]);
                } else {
                    // 万が一足りない場合は空白などを詰める
                    viewSlice.push({ display: "   " }); 
                }
            }

            const isLastFrame = currentFrame >= maxFrames;
            const bracketColor = isLastFrame ? "§e" : "§f";

            // 表示文字列の構築
            const displayParts = viewSlice.map((symbolObj, index) => {
                if (index === centerOffset) {
                    // 真ん中は括弧で囲む
                    return `${bracketColor}[§r ${symbolObj.display} ${bracketColor}]§r`;
                }
                return "  " + symbolObj.display + "  ";
            });
            const displayString = displayParts.join("");
            
            // 画面表示
            player.onScreenDisplay.setTitle(displayString, {
                fadeInDuration: 0,
                stayDuration: 20, 
                fadeOutDuration: 0,
            });
            player.onScreenDisplay.updateSubtitle("");
            player.playSound(CONFIG.soundTick, { pitch: 1.0 }); 

            // アニメーション終了判定
            if (isLastFrame) {
                // 最終的に真ん中に止まったシンボルを取得
                // currentFrame時点での centerOffset の位置にあるシンボル
                const resultIndex = currentFrame + centerOffset;
                const resultSymbol = reel[resultIndex];

                this.showResult(player, resultSymbol, onComplete);
            } else {
                // 次のフレームへ
                currentFrame++;
                
                // 進行度に合わせて遅延を計算（徐々に遅くする）
                const progress = currentFrame / maxFrames;
                const baseDelay = CONFIG.scrollSpeed; 
                const addedDelay = 8 * (progress * progress * progress); // 3乗カーブで減速
                const delay = Math.max(1, Math.floor(baseDelay + addedDelay));
                
                system.runTimeout(loop, delay);
            }
        };
        loop();
    }

    /**
     * 結果発表とコマンド実行
     */
    static showResult(player, symbol, onComplete) {
        system.runTimeout(() => {
            if (!player.isValid()) {
                if (onComplete) onComplete();
                return;
            }

            // タイトル表示
            player.onScreenDisplay.setTitle(symbol.title, {
                fadeInDuration: 2,
                stayDuration: 60,
                fadeOutDuration: 10
            });
            player.onScreenDisplay.updateSubtitle(symbol.subtitle);

            // HR (ハイパーレア) または secret (シークレット) が当選した場合のみ、ワールド内の全プレイヤーにチャットで告知とサウンド再生を行う
            if (symbol.id === "HR" || symbol.id === "secret") {
                world.sendMessage(`§a[MSS] §r§f${player.name}さんがイラストガチャで §l${symbol.title}§r§f を当てました！おめでとうございます！`);
                
                // 全プレイヤーに対して当選時の効果音を再生する（どこにいても聞こえるように個別再生）
                if (symbol.sound) {
                    for (const p of world.getAllPlayers()) {
                        p.playSound(symbol.sound);
                    }
                }
            } else {
                // 通常のレアリティの場合は、当選した本人にのみサウンドを再生する
                if (symbol.sound) {
                    player.playSound(symbol.sound);
                }
            }

            // 花火演出（コマンドがある場合のみ）
            if (symbol.commands && symbol.commands.length > 0) {
                try {
                    player.dimension.spawnEntity("minecraft:fireworks_rocket", player.location);
                } catch(e) {}
            }

            // コマンド実行（ランダムに1つ選択）
            if (symbol.commands && symbol.commands.length > 0) {
                const randomCommand = symbol.commands[Math.floor(Math.random() * symbol.commands.length)];
                // コマンドは非同期実行
                player.runCommandAsync(randomCommand).catch(e => {
                    console.warn(`Command failed: ${e}`);
                });
            }

            // 終了コールバック
            if (onComplete) system.runTimeout(onComplete, 60);

        }, 15); // 回転停止から一呼吸おいて結果表示
    }
}