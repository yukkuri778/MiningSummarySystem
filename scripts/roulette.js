import { world, system } from "@minecraft/server";

// --- デフォルト設定 ---
// スコアボードで設定されていない場合、この値が使われます
const DEFAULT_CONFIG = {
    winRate: 30,          // スコアボード: mss_rate
    scrollSpeed: 2,       // スコアボード: mss_speed
    reelLength: 40,       // スコアボード: mss_len
    
    randomLengthRange: 20,
    viewWidth: 7,
    
    symbolWin: "§cO§r",
    symbolLose: "§8X§r",
    
    soundTick: "random.click",
    soundWin: "random.levelup",
    soundLose: "random.break",

    // デフォルトの実行コマンド（IDごとの個別設定はタグ mss_win_<ID> を検知してコマンドブロックで行うのを推奨）
    commandWin: "", 
    commandLose: "",
};

// 設定用スコアボード名
const OBJ_RATE = "mss_rate";
const OBJ_SPEED = "mss_speed";
const OBJ_LEN = "mss_len";

// ルーレット実行フラグ用プロパティ
const ROULETTE_PLAYING_PROP = "mss:roulette_playing";

/**
 * ルーレットシステムクラス
 */
export class RouletteSystem {

    /**
     * システム初期化
     * 設定用スコアボードが存在しない場合は作成します
     */
    static initialize() {
        if (!world.scoreboard.getObjective(OBJ_RATE)) world.scoreboard.addObjective(OBJ_RATE, "MSS:確率(%)");
        if (!world.scoreboard.getObjective(OBJ_SPEED)) world.scoreboard.addObjective(OBJ_SPEED, "MSS:速度(tick)");
        if (!world.scoreboard.getObjective(OBJ_LEN)) world.scoreboard.addObjective(OBJ_LEN, "MSS:長さ");
    }

    /**
     * ルーレットを開始します。
     * @param {import("@minecraft/server").Player} player 
     * @param {string} rouletteId ルーレットID（省略時は "default"）
     */
    static start(player, rouletteId = "default") {
        // 設定の取得（スコアボード > デフォルト値）
        const config = this.getConfig(rouletteId);

        // 実行中フラグON
        player.setDynamicProperty(ROULETTE_PLAYING_PROP, true);

        // 1. 抽選
        const isWin = (Math.random() * 100) < config.winRate;

        // 2. リール長の決定
        const randomAdded = Math.floor(Math.random() * (config.randomLengthRange + 1));
        const totalLength = config.reelLength + randomAdded;

        // 3. リール生成
        const reel = this.generateReel(isWin, totalLength, config);

        // 4. アニメーション開始
        this.playAnimation(player, reel, isWin, config, rouletteId, () => {
            // 完了時のコールバック
            if (player.isValid()) {
                player.setDynamicProperty(ROULETTE_PLAYING_PROP, undefined);
            }
        });
    }

    /**
     * 指定されたIDの設定を取得します。
     * スコアボードに値があればそれを、なければデフォルト値を返します。
     * 設定用ダミープレイヤー名: config_<ID>
     */
    static getConfig(id) {
        // 基本設定をコピー
        const conf = { ...DEFAULT_CONFIG };
        const holderName = `config_${id}`;

        // スコアボードから値を取得して上書き
        try {
            const getVal = (objName) => {
                const obj = world.scoreboard.getObjective(objName);
                if (!obj) return null;
                // ダミープレイヤーのスコア取得（participantが存在しないとundefinedになる場合があるためtry-catchやnullチェック）
                try {
                    return obj.getScore(holderName);
                } catch {
                    return undefined;
                }
            };

            const rate = getVal(OBJ_RATE);
            if (rate !== undefined && rate !== null) conf.winRate = rate;

            const speed = getVal(OBJ_SPEED);
            if (speed !== undefined && speed !== null) conf.scrollSpeed = speed;

            const len = getVal(OBJ_LEN);
            if (len !== undefined && len !== null) conf.reelLength = len;

        } catch (e) {
            console.warn(`[RouletteSystem] Failed to load config for ${id}: ${e}`);
        }

        return conf;
    }

    static generateReel(isWin, totalLength, config) {
        const reel = [];
        const centerIndex = Math.floor(config.viewWidth / 2);
        
        for (let i = 0; i < totalLength; i++) {
            const isSymbolWin = Math.random() < 0.5;
            reel.push(isSymbolWin ? config.symbolWin : config.symbolLose);
        }

        const finalFrameStartIndex = totalLength - config.viewWidth;
        const resultIndex = finalFrameStartIndex + centerIndex;
        reel[resultIndex] = isWin ? config.symbolWin : config.symbolLose;

        return reel;
    }

    static playAnimation(player, reel, isWin, config, rouletteId, onComplete) {
        let currentFrame = 0;
        const maxFrames = reel.length - config.viewWidth;
        const centerOffset = Math.floor(config.viewWidth / 2);

        const loop = () => {
            if (!player.isValid()) {
                if (onComplete) onComplete();
                return;
            }

            const viewSlice = reel.slice(currentFrame, currentFrame + config.viewWidth);
            const isLastFrame = currentFrame === maxFrames;
            const bracketColor = isLastFrame ? "§e" : "§f";

            const displayParts = viewSlice.map((symbol, index) => {
                if (index === centerOffset) {
                    return `${bracketColor}[§r ${symbol} ${bracketColor}]§r`;
                }
                return "  " + symbol + "  ";
            });
            const displayString = displayParts.join("");
            
            player.onScreenDisplay.setTitle(displayString, {
                fadeInDuration: 0,
                stayDuration: 20, 
                fadeOutDuration: 0,
            });
            player.onScreenDisplay.updateSubtitle("");
            player.playSound(config.soundTick, { pitch: 1.0 }); 

            currentFrame++;

            if (currentFrame > maxFrames) {
                this.showResult(player, isWin, config, rouletteId, onComplete);
            } else {
                const progress = currentFrame / maxFrames;
                const baseDelay = config.scrollSpeed; 
                const addedDelay = 8 * (progress * progress * progress);
                const delay = Math.max(1, Math.floor(baseDelay + addedDelay));
                system.runTimeout(loop, delay);
            }
        };
        loop();
    }

    static showResult(player, isWin, config, rouletteId, onComplete) {
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
                player.playSound(config.soundWin);
                player.dimension.spawnEntity("minecraft:fireworks_rocket", player.location);
                
                // タグの付与 (mss_win_<ID>)
                const winTag = `mss_win_${rouletteId}`;
                player.addTag("mss_win"); // 汎用タグ
                player.addTag(winTag);    // ID専用タグ

                // デフォルトコマンド実行
                if (config.commandWin) player.runCommandAsync(config.commandWin);

                // 1秒後にタグを削除
                system.runTimeout(() => {
                    if (player.isValid()) {
                        player.removeTag("mss_win");
                        player.removeTag(winTag);
                    }
                }, 20);

            } else {
                player.playSound(config.soundLose);
                // はずれタグも一応つける
                const loseTag = `mss_lose_${rouletteId}`;
                player.addTag(loseTag);

                if (config.commandLose) player.runCommandAsync(config.commandLose);

                system.runTimeout(() => {
                    if (player.isValid()) player.removeTag(loseTag);
                }, 20);
            }

            if (onComplete) system.runTimeout(onComplete, 60);

        }, 5);
    }
}