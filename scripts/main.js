import { world, system, ItemStack } from "@minecraft/server";
import { RouletteSystem } from "./roulette.js";
import { NacoRoulette } from "./nacoroulette.js";
import { startChestRoulette } from "./chest_roulette.js";

// --- 定数定義 ---

const BEHAVIOR_PACK_VERSION = "1.7.2"; // パックのバージョン

// スコアボード名
const MINING_COUNT_OBJECTIVE = "mining_count"; // プレイヤーごとの採掘数
const WORLD_MINING_COUNT_OBJECTIVE = "world_mining"; // ワールド全体の統計

// ワールド統計用スコアボードの偽プレイヤー名
const WORLD_TOTAL_HOLDER = "world_total"; // ワールド全体の総採掘数

// Dynamic Property のプレフィックス
const BLOCK_COUNT_PREFIX = "block_count:"; // ブロックごとの採掘数
const DAILY_MINING_OBJECTIVE = "daily_mining"; // デイリー採掘数のスコアボード名
const DAILY_MINING_DATE_PROP = "mss:daily_mining_date"; // デイリー採掘日の記録(Dynamic Property)
const ACTION_BAR_ENABLED_PROP = "actionBar:enabled"; // アクションバー表示設定
const PLAYER_NAME_MAP_PROP = "mss:player_name_map"; // プレイヤーIDと名前の対応表

// 表示モード定数
const DISPLAY_MODE_ALL = 0;
const DISPLAY_MODE_SIMPLE = 1;
const DISPLAY_MODE_NONE = 2;

// コマンド用イベントID
const RANK_EVENT_ID = "mss:rank";
const RANK_ALL_EVENT_ID = "mss:rank_all";
const RANK_DAILY_EVENT_ID = "mss:rank_daily"; // デイリーランキングを表示するためのイベントID
const SUMMARY_EVENT_ID = "mss:summary";
const RESET_EVENT_ID = "mss:reset";
const CHECKV_EVENT_ID = "mss:checkV";
const ROULETTE_EVENT_ID = "mss:roulette";
const NACO_ROULETTE_EVENT_ID = "mss:naco";

const WORLD_DAILY_RESET_DATE_PROP = "mss:world_daily_reset_date"; // ワールド全体で最後にデイリーリセットを行った日付を記録するDynamic Propertyのキー名

// リセット確認用の待機時間（ミリ秒）
const RESET_CONFIRMATION_TIMEOUT = 10000; // 10秒

// ログ表示用タグ名
const TAG_LOG = "logListener";

// プレイヤー個人のお祝い閾値リスト
// ※ 旧実装では playerBreakBlock イベント内で毎回生成されていたため、採掘のたびに配列オブジェクトが新規生成されていた。
// 定数としてトップレベルに置くことで、拒たことでガベージコレクションの負荷を削減する。
const PLAYER_CELEBRATION_MILESTONES = new Set([100, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 40000, 50000]);

// ワールド全体のお祝い閾値リスト
const WORLD_CELEBRATION_MILESTONES = new Set([1000, 3000, 5000, 10000, 30000, 50000, 100000, 200000, 300000, 400000, 500000]);

// カウントしないブロックのリスト
const EXCLUDED_BLOCKS = new Set([
    "minecraft:air",
    "minecraft:grass",
    "minecraft:tall_grass",
    "minecraft:double_plant",
    "minecraft:fern",
    "minecraft:red_flower",
    "minecraft:yellow_flower",
    "minecraft:sapling",
    "minecraft:short_grass",
    "minecraft:deadbush",
    "minecraft:dandelion",
    "minecraft:vine",
    "minecraft:waterlily",
    "minecraft:web",
    "minecraft:brown_mushroom",
    "minecraft:red_mushroom",
    "minecraft:torch",
    "minecraft:redstone_torch",
    "minecraft:lever",
    "minecraft:leaf_litter",
    "minecraft:tripwire_hook",
    "minecraft:tripwire",
    "minecraft:netherrack",
    "minecraft:undyed_shulker_box",
    "minecraft:white_shulker_box",
    "minecraft:orange_shulker_box",
    "minecraft:magenta_shulker_box",
    "minecraft:light_blue_shulker_box",
    "minecraft:yellow_shulker_box",
    "minecraft:lime_shulker_box",
    "minecraft:pink_shulker_box",
    "minecraft:gray_shulker_box",
    "minecraft:light_gray_shulker_box",
    "minecraft:cyan_shulker_box",
    "minecraft:purple_shulker_box",
    "minecraft:blue_shulker_box",
    "minecraft:brown_shulker_box",
    "minecraft:green_shulker_box",
    "minecraft:red_shulker_box",
    "minecraft:black_shulker_box",
]);

// --- 下掘り警告判定から除外するブロックのリスト ---
// プレイヤーが以下のブロックを破壊（採掘）した場合は、頭上のチェックおよび下掘り警告の判定処理がスキップされます。
// 誤検知を防ぎたいブロック（はしご、松明など）をこの Set に定義します。
// ※ 配列の includes() は O(n) の線形探索だが、Set の has() は O(1) のハッシュ検索のため高速。
const WARNING_EXCLUDED_BLOCKS = new Set([
    "minecraft:ladder",        // はしご
    "minecraft:vine",          // ツタ
    "minecraft:torch",         // 松明
    "minecraft:soul_torch",    // ソウルトーチ
    "minecraft:redstone_torch",// レッドストーントーチ
    "minecraft:lantern",       // ランタン
    "minecraft:soul_lantern",  // ソウルランタン
    "minecraft:chest",         // チェスト
    "minecraft:undyed_shulker_box",
    "minecraft:white_shulker_box",
    "minecraft:orange_shulker_box",
    "minecraft:magenta_shulker_box",
    "minecraft:light_blue_shulker_box",
    "minecraft:yellow_shulker_box",
    "minecraft:lime_shulker_box",
    "minecraft:pink_shulker_box",
    "minecraft:gray_shulker_box",
    "minecraft:light_gray_shulker_box",
    "minecraft:cyan_shulker_box",
    "minecraft:purple_shulker_box",
    "minecraft:blue_shulker_box",
    "minecraft:brown_shulker_box",
    "minecraft:green_shulker_box",
    "minecraft:red_shulker_box",
    "minecraft:black_shulker_box",
    "minecraft:cherry_log",
    "minecraft:cherry_leaves",
]);

// --- グローバル変数 ---

// リセット要求を管理するオブジェクト { playerId: timestamp }
let resetRequests = {};
// 露天掘り警告の履歴を管理するオブジェクト { playerId: [timestamp] }
let warningHistory = {};
// 最終ログ出力時刻を管理するオブジェクト { playerId: timestamp }
let lastLogTime = {};

// プレイヤーの参加時刻を管理するオブジェクト { playerId: timestamp }
let playerJoinTimes = {};

// プレイヤー名マップのメモリ内キャッシュ
// 旧実装では runInterval 内で毎秒 getDynamicProperty + JSON.parse を実行していた。
// カード変数として保持することで、書き込み時のみ Dynamic Property を読み込むよう改善する。
let cachedNameMap = null;

// --- ヘルパー関数 ---

/**
 * TAG_LOG（logListenerタグ）を持つオンラインプレイヤー全員に §a[MSSlog]§7 プレフィックス付きでメッセージを送ります。
 * 旧実装では同じ for ループパターンがファイル全体で 20 回以上重複していたため、この関数に集約しました。
 * @param {string} message - 送信するメッセージ本文（§a[MSSlog]§7 のプレフィックスは自動付与）
 */
function sendLog(message) {
    for (const p of world.getAllPlayers()) {
        if (p.hasTag(TAG_LOG)) {
            p.sendMessage(`§a[MSSlog]§7${message}`);
        }
    }
}

/**
 * 現在の時刻から、デイリーリセット（朝4時）を考慮した「日付文字列」を取得します。
 * 朝4時までは前日として扱われます。
 */
function getDailyDateString() {
    // JSTなどのタイムゾーンに依存せず、単純に現在時刻から4時間引くことで朝4時を日界とする
    const adjustedTime = new Date(Date.now() - 4 * 60 * 60 * 1000);
    return `${adjustedTime.getFullYear()}-${adjustedTime.getMonth() + 1}-${adjustedTime.getDate()}`;
}

/**
 * ワールド全体のデイリーリセット処理を実行します。
 * 前回のリセット日と現在の日付が異なる場合、デイリー採掘スコアボードを全員分クリアし、日付プロパティを更新します。
 * これにより、オフラインプレイヤーの古いデイリーデータがランキングに残るのを防ぎます。
 */
function checkWorldDailyReset() {
    try {
        const currentDateStr = getDailyDateString();
        const lastResetDate = world.getDynamicProperty(WORLD_DAILY_RESET_DATE_PROP);
        
        // 日付が変わっている場合のみリセット処理を実行
        if (lastResetDate !== currentDateStr) {
            const dailyObjective = world.scoreboard.getObjective(DAILY_MINING_OBJECTIVE);
            if (dailyObjective) {
                // スコアボードに登録されている全参加者（オフライン含む）のスコアをクリア
                for (const participant of dailyObjective.getParticipants()) {
                    dailyObjective.removeParticipant(participant);
                }
            }
            // ワールド全体のデイリーリセット日プロパティを更新
            world.setDynamicProperty(WORLD_DAILY_RESET_DATE_PROP, currentDateStr);

            // 現在オンラインのプレイヤーの個別日付プロパティおよびスコアボードも同期的にリセット
            for (const player of world.getAllPlayers()) {
                player.setDynamicProperty(DAILY_MINING_DATE_PROP, currentDateStr);
                if (dailyObjective) {
                    dailyObjective.setScore(player, 0);
                }
            }

            // ログ権限を持つプレイヤーへの通知
            sendLog(`ワールドのデイリーリセットが実行されました：${currentDateStr}`);
        }
    } catch (e) {
        console.error(`[MiningRanking] Failed world daily reset check: ${e}`);
    }
}

// --- 初期化処理 ---

/**
 * ワールド初期化時にスコアボードを設定します。
 */
world.afterEvents.worldInitialize.subscribe(() => {
    // プレイヤーごとの採掘数スコアボード
    if (!world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE)) {
        world.scoreboard.addObjective(MINING_COUNT_OBJECTIVE, "採掘数");
    }

    if (!world.scoreboard.getObjective(DAILY_MINING_OBJECTIVE)) {
        world.scoreboard.addObjective(DAILY_MINING_OBJECTIVE, "デイリー採掘数");
    }

    // ワールド統計用スコアボード
    if (!world.scoreboard.getObjective(WORLD_MINING_COUNT_OBJECTIVE)) {
        world.scoreboard.addObjective(WORLD_MINING_COUNT_OBJECTIVE, "ワールド統計");
    }

    // ルーレット初期化（スコアボード作成）
    RouletteSystem.initialize();

    // 初期化時にデイリーリセット判定を実施
    checkWorldDailyReset();
});

// --- イベントリスナー ---

/**
 * プレイヤーが参加したときのイベントを処理します。
 */
world.afterEvents.playerJoin.subscribe(event => {
    const { player } = event;
    
    // ログイン時に日付変更判定とデイリーリセットチェックを実施
    checkWorldDailyReset();

    // 参加時刻を記録 (5秒間の初期化猶予のため)
    playerJoinTimes[player.id] = Date.now();

    // アクションバー表示設定がまだない場合、デフォルトでONにする
    if (player.getDynamicProperty(ACTION_BAR_ENABLED_PROP) === undefined) {
        player.setDynamicProperty(ACTION_BAR_ENABLED_PROP, DISPLAY_MODE_ALL);
    }
    
    // ログ通知：logListenerタグを持つプレイヤーに参加通知を送る
    sendLog(`初参加：${player.name}`);

    // ログイン5秒後（100 ticks）に日付変更確認＆個別リセット処理を実行
    system.runTimeout(() => {
        try {
            // プレイヤーが現在もワールドにいるか確認
            if (!player.isValid()) return;

            const currentDateStr = getDailyDateString();
            const lastDateStr = player.getDynamicProperty(DAILY_MINING_DATE_PROP);
            
            // 日付をまたいでいる場合のみリセット
            if (lastDateStr !== currentDateStr) {
                let dailyObjective = world.scoreboard.getObjective(DAILY_MINING_OBJECTIVE);
                if (!dailyObjective) {
                    dailyObjective = world.scoreboard.addObjective(DAILY_MINING_OBJECTIVE, "デイリー採掘数");
                }
                
                // 次に掘るまで待たずにこの時点でスコアボードを0にリセット
                dailyObjective.setScore(player, 0);
                player.setDynamicProperty(DAILY_MINING_DATE_PROP, currentDateStr);

                // ログ通知（sendLogヘルパーで簡潔化）
                sendLog(`デイリーリセット実行(参加時)：${player.name}`);
            }
        } catch (e) {
            console.warn(`[MiningRanking] Failed daily reset check on join: ${e}`);
            }
    }, 100);
});

/**
 * プレイヤーが退出したときのイベントを処理します。
 */
world.afterEvents.playerLeave.subscribe(event => {
    const { playerId } = event;
    
    // メモリリークを防ぐため、プレイヤーに紐づくすべてのグローバルデータを削除する。
    // 削除しないと、プレイヤーが入退出を繰り返すたびにエントリが増え続けてメモリを圧迫する。
    delete playerJoinTimes[playerId];  // 参加時刻
    delete warningHistory[playerId];   // 下掘り警告履歴
    delete lastLogTime[playerId];      // 最終警告ログ時刻
    delete resetRequests[playerId];    // リセット確認待ち状態（退出時は確認をキャンセル）
});

/**
 * プレイヤーがブロックを破壊したときのイベントを処理します。
 */
world.afterEvents.playerBreakBlock.subscribe(event => {
    const { player, brokenBlockPermutation } = event;
    const blockId = brokenBlockPermutation.type.id;

    // 除外リストに含まれるブロックはカウントしない
    if (EXCLUDED_BLOCKS.has(blockId)) {
        return;
    }

    // クリエイティブモードのプレイヤーはカウントしない。
    // 旧実装: world.getPlayers({ gameMode: "creative" }) で全クリエイティブプレイヤーリストを生成し some() で探索 → O(n)
    // 新実装: player.getGameMode() で破壊したプレイヤー自身のみ確認 → O(1)
    try {
        if (player.getGameMode() === "creative") {
            return; // クリエイティブモードなら以降の処理をしない
        }
    } catch(e) {
        console.error(`[MiningRanking] Failed to check gamemode: ${e}`);
        sendLog("エラー：ゲームモードの確認に失敗しました。");
        return; // 安全のため、エラー時もカウントしない
    }

    // 採掘場所周辺のチェック（露天掘り判定）
    // 掘ったブロックの上5マス目を確認し、空気ブロック以外があれば警告を出力する
    // ただし、以下の場合は判定を行いません：
    // 1. プレイヤーがホワイトリスト（whiteListタグ）に登録されている場合
    // 2. 破壊したブロックが警告除外リスト（WARNING_EXCLUDED_BLOCKS）に含まれている場合
    // 3. 破壊したブロックが鉱石ブロックである場合（ブロックIDに "ore" が含まれるか判定）
    // Set.has() は O(1) のハッシュ検索なので、旧実装の Array.includes() より高速
    const isExcludedBlock = WARNING_EXCLUDED_BLOCKS.has(blockId) || blockId.includes("ore");
    if (!player.hasTag("whiteList") && !isExcludedBlock) {
        try {
            const { x, y, z } = event.block.location;
            const dimension = event.block.dimension;
            let hasNonAirAbove = false;

            // 上5ブロック目（既存コードの y + 7）のみチェック
            const blockAbove = dimension.getBlock({ x: x, y: y + 5, z: z });
            if (blockAbove && blockAbove.typeId !== "minecraft:air") {
                hasNonAirAbove = true;
            }

            if (hasNonAirAbove) {
                const now = Date.now();
                
                // 履歴配列がなければ初期化
                if (!warningHistory[player.id]) warningHistory[player.id] = [];
                
                // 現在の時刻を履歴に追加
                warningHistory[player.id].push(now);

                // 5秒以内の履歴のみ保持（古い警告をフィルタリング）
                warningHistory[player.id] = warningHistory[player.id].filter(t => now - t <= 5000);

                // 5秒以内に7回以上警告が記録された場合のみログを出力
                if (warningHistory[player.id].length >= 7) {
                    const lastLog = lastLogTime[player.id] || 0;

                    player.sendMessage(`§c[MSS]§e警告：下堀りを検知しました。必ず上から掘ってください。繰り返される場合、管理者によって処罰される可能性があります。`);
                    
                    // 前回のログ出力から5秒以上経過している場合のみ出力（連投スパム防止）
                    if (now - lastLog >= 5000) {
                        // sendLog() で logListener タグ持ちプレイヤーに一括通知
                        // ※ 下掘り検知のみカラーコードが異なるため直接ループを使用
                        for (const p of world.getAllPlayers()) {
                            if (p.hasTag(TAG_LOG)) {
                                p.sendMessage(`§a[MSSlog]§e下掘り検知：§e${player.name} §7(${x}, ${y}, ${z})`);
                            }
                        }

                        // ログを出力したら履歴をリセット
                        warningHistory[player.id] = [];
                        // 最終ログ出力時刻を更新
                        lastLogTime[player.id] = now;
                    } else {
                        // 頻繁すぎる場合は履歴だけリセットして、次の判定を待つ（スパム防止）
                         warningHistory[player.id] = [];
                    }
                }
            }
        } catch(e) {
            console.warn(`[MiningRanking] Failed to check blocks above: ${e}`);
        }
    }

    // 1. プレイヤーの採掘数を1増やす
    try {
        // デイリー採掘数の更新処理 (スコアボード反映)
        const currentDateStr = getDailyDateString();
        const lastDateStr = player.getDynamicProperty(DAILY_MINING_DATE_PROP);
        
        let dailyObjective = world.scoreboard.getObjective(DAILY_MINING_OBJECTIVE);
        if (!dailyObjective) {
            dailyObjective = world.scoreboard.addObjective(DAILY_MINING_OBJECTIVE, "デイリー採掘数");
        }
        
        if (lastDateStr === currentDateStr) {
            dailyObjective.addScore(player, 1);
        } else {
            // 日付が変わった場合は0始まりとして1をセット
            dailyObjective.setScore(player, 1);
        }
        
        player.setDynamicProperty(DAILY_MINING_DATE_PROP, currentDateStr);

        const objective = world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE);
        // スコアをインクリメントし、新しいスコアを取得
        const newScore = objective.addScore(player, 1);

        // PLAYER_CELEBRATION_MILESTONES はトップレベルの Set 定数。
        // 旧実装: ここで配列を毎回新規生成 + Array.includes() で O(n) 検索していた。
        // 新実装: 定数化した Set の has() で O(1) 検索。
        if (PLAYER_CELEBRATION_MILESTONES.has(newScore)) {
            // お祝いメッセージ
            world.sendMessage(`§a[MSS]§f§l§k!!!§r §b${player.name}§r が採掘数 §e${newScore}個§r を突破しました！ §k!!!§r`);
            // 花火を打ち上げる
            player.dimension.spawnEntity("minecraft:fireworks_rocket", player.location);
            // 経験値取得音を全プレイヤーに再生
            for (const p of world.getAllPlayers()) {
                p.playSound("random.orb", p.location);
            }
        }

        // 以降１０万ごとにお祝い
        else if(newScore % 100000 == 0){ 
            world.sendMessage(`§a[MSS]§f§l§k!!!§r §b${player.name}§r が採掘数 §e${newScore}個§r を突破しました！ §k!!!§r`);
            player.dimension.spawnEntity("minecraft:fireworks_rocket", player.location);
            for (const p of world.getAllPlayers()) {
                p.playSound("random.orb", p.location);
            }
        }


    } catch (e) {
        console.error(`[MiningRanking] Failed to add score to player ${player.name}: ${e}`);
        sendLog(`エラー：プレイヤーの採掘数の更新に失敗しました。`);
    }

    // 2. ワールド全体の総採掘数を1増やす
    try {
        const objective = world.scoreboard.getObjective(WORLD_MINING_COUNT_OBJECTIVE);
        const newWorldScore = objective.addScore(WORLD_TOTAL_HOLDER, 1);

        // WORLD_CELEBRATION_MILESTONES はトップレベルの Set 定数。
        // 旧実装: ここで配列を毎回新規生成 + includes() 検索。
        // 新実装: 定数化した Set の has() で O(1) 検索。
        if (WORLD_CELEBRATION_MILESTONES.has(newWorldScore)) {
            // お祝いメッセージ
            world.sendMessage(`§a[MSS]§f§l§k!!!§r §dワールド総採掘数§r が §e${newWorldScore}個§r に到達しました！ §k!!!§r`);
            // 全てのプレイヤーから花火を打ち上げる&音を再生
            for (const p of world.getAllPlayers()) {
                p.dimension.spawnEntity("minecraft:fireworks_rocket", p.location);
                p.playSound("random.levelup", p.location);
            }
        }

        // 以降１００万ごとにお祝い
        else if(newWorldScore % 1000000 == 0){
            world.sendMessage(`§a[MSS]§f§l§k!!!§r §dワールド総採掘数§r が §e${newWorldScore}個§r に到達しました！ §k!!!§r`);
            for (const p of world.getAllPlayers()) {
                p.dimension.spawnEntity("minecraft:fireworks_rocket", p.location);
                p.playSound("random.levelup", p.location);
            }
        }

    } catch (e) {
        console.error(`[MiningRanking] Failed to add score to world total: ${e}`);
        sendLog(`ワールド採掘数更新エラー：${e}`);
    }

    // 3. ブロックごとの採掘数をカウント
    const propId = `${BLOCK_COUNT_PREFIX}${blockId}`;
    const currentBlockCount = world.getDynamicProperty(propId);
    if (typeof currentBlockCount === 'number') {
        world.setDynamicProperty(propId, currentBlockCount + 1);
    } else {
        world.setDynamicProperty(propId, 1);
    }

    // 4. 宝箱ドロップ判定(0.0001で1/10000)
    if (Math.random() < 0.00013) {
        // アイテムをドロップさせる
        try {
            // プレイヤーの位置にドロップ
            const itemStack = new ItemStack("mss:nakoiribukuro", 1);
            player.dimension.spawnItem(itemStack, player.location);
            
            player.sendMessage("§a[MSS]§gラッキー！§fブロックの中から§dなこ入り袋§fを見つけた！");
            player.playSound("random.pop", player.location);
        } catch (e) {
            console.error(`Failed to drop treasure chest: ${e}`);
        }
    }
});

/**
 * functionコマンドから送られたイベントを処理します。
 */
system.afterEvents.scriptEventReceive.subscribe(event => {
    const { id, sourceEntity } = event;

    // 実行者がプレイヤーでない場合は処理しない
    if (!sourceEntity || sourceEntity.typeId !== 'minecraft:player') return;

    if (id === RANK_EVENT_ID) {
        showRank(sourceEntity);
    } else if (id === RANK_ALL_EVENT_ID) {
        showRankAll(sourceEntity);
    } else if (id === RANK_DAILY_EVENT_ID) {
        showDailyRank(sourceEntity);
    } else if (id === SUMMARY_EVENT_ID) {
        showSummary(sourceEntity);
    } else if (id === RESET_EVENT_ID) {
        handleResetRequest(sourceEntity);
    } else if (id === CHECKV_EVENT_ID) {
        showVersion(sourceEntity);
    } else if (id === ROULETTE_EVENT_ID) {
        // メッセージをIDとして扱う。空なら "default"
        const rouletteId = event.message && event.message.trim().length > 0 ? event.message.trim() : "default";
        RouletteSystem.start(sourceEntity, rouletteId);
    } else if (id === NACO_ROULETTE_EVENT_ID) {
        NacoRoulette.start(sourceEntity);
    }
    // sendLog ヘルパーでコマンド実行ログを送信
    sendLog(`コマンド実行：${sourceEntity.name}, ${id}`);
});

/**
 * プレイヤーがアイテムを使用したときのイベントを処理します。
 */
world.afterEvents.itemUse.subscribe(event => {
    const { source, itemStack } = event;
    if (source.typeId !== 'minecraft:player') return;

    // コンパス使用時の処理（スニーク状態ならデイリーランキング、通常状態なら全体ランキングを表示）
    if (itemStack.typeId === 'minecraft:compass') {
        system.run(() => {
            if (source.isSneaking) {
                showDailyRank(source);
            } else {
                showRank(source);
            }
        });
        sendLog(`アイテム使用（コンパス）：${source.name} (スニーク: ${source.isSneaking})`);
    } 

    // 宝箱を使用
    else if (itemStack.typeId === 'mss:nakoiribukuro') {
        startChestRoulette(source);
        sendLog(`アイテム使用：${source.name}, ${itemStack.typeId}`);
    }
    // 時計使用でアクションバー表示を切り替え
    else if (itemStack.typeId === 'minecraft:clock') {
        let currentStatus = source.getDynamicProperty(ACTION_BAR_ENABLED_PROP);
        
        // 互換性対応: boolean または undefined の場合を数値に変換
        if (currentStatus === true || currentStatus === undefined) currentStatus = DISPLAY_MODE_ALL;
        else if (currentStatus === false) currentStatus = DISPLAY_MODE_NONE;
        
        // 次のモードへ (0 -> 1 -> 2 -> 0)
        const newStatus = (currentStatus + 1) % 3;
        source.setDynamicProperty(ACTION_BAR_ENABLED_PROP, newStatus);

        if (newStatus === DISPLAY_MODE_ALL) {
            source.sendMessage("§a[MSS]§aアクションバー表示：すべて");
        } else if (newStatus === DISPLAY_MODE_SIMPLE) {
             source.sendMessage("§a[MSS]§aアクションバー表示：採掘数と所持金のみ");
        } else {
            source.sendMessage("§a[MSS]§cアクションバー表示：OFF");
            // OFFにした直後にアクションバーをクリアする
            source.onScreenDisplay.setActionBar("");
        }
        sendLog(`アイテム使用：${source.name}, ${itemStack.typeId}`);
    }
});


// --- 定期実行処理 ---

/**
 * 1秒ごとに各プレイヤーのアクションバーを更新します。
 * プレイヤー名マップの更新もここで行います。
 */
system.runInterval(() => {
    try {
        const players = world.getAllPlayers();
        if (players.length === 0) return;

        // cachedNameMap を使用する。
        // 旧実装: 毎秒 getDynamicProperty + JSON.parse を実行していた（メモリ・ CPU に無駄）。
        // 新実装: 初回実行時のみ DynamicProperty を読み込み、以降は内容が変更された時のみ更新する。
        if (cachedNameMap === null) {
            const nameMapStr = world.getDynamicProperty(PLAYER_NAME_MAP_PROP);
            cachedNameMap = nameMapStr ? JSON.parse(nameMapStr) : {};
        }
        let isMapDirty = false; // Dynamic Property の保存が必要かどうかのフラグ

        const objective = world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE);
        
        // objectiveがない場合は、ここでもマップ更新だけはしておくと安全ですが、
        // 今回はスコアボード依存の処理がメインなので、objectiveがない場合はreturnのままで進めます
        if (!objective) return;

        // 全プレイヤーのスコアを取得し、ランキングを生成
        const allScores = objective.getScores();
        allScores.sort((a, b) => b.score - a.score);

        // 各プレイヤーの情報を更新
        for (const player of players) {
            
            // scoreboardIdentity が有効な場合のみ名前マップを更新
            if (player.scoreboardIdentity) {
                const pId = player.scoreboardIdentity.id;
                // cachedNameMap を使用して内容を確認（毎秒の JSON.parse を排除）
                if (cachedNameMap[pId] !== player.name) {
                    cachedNameMap[pId] = player.name;
                    isMapDirty = true; // 保存フラグを立てる
                    // この world.sendMessage はデバッグ用のためコメントアウト
                    // world.sendMessage(`§a[MSS]§7プレイヤー名マップ更新：${player.name}`);
                }
            }

            // モード取得と正規化
            let mode = player.getDynamicProperty(ACTION_BAR_ENABLED_PROP);
            if (mode === true || mode === undefined) mode = DISPLAY_MODE_ALL;
            else if (mode === false) mode = DISPLAY_MODE_NONE;

            // アクションバー表示がOFFのプレイヤーはスキップ
            if (mode === DISPLAY_MODE_NONE) {
                continue;
            }

            if (player.scoreboardIdentity === undefined) {
                // IDがない = 初回またはデータロスト なので初期化
                const joinTime = playerJoinTimes[player.id] || Date.now();
                
                // 参加から5秒（5000ミリ秒）経過している場合のみ初期化
                if (Date.now() - joinTime > 5000) {
                    objective.setScore(player, 0);
                    sendLog(`リロード初期化（ID生成）：${player.name}`);
                } else {
                    // まだ読み込み中の可能性があるため、今回はスキップして再チェックを待つ
                    continue;
                }
            }

            const myScore = objective.getScore(player) ?? 0;
            const myRank = allScores.findIndex(s => s.participant.id === player.scoreboardIdentity?.id) + 1; // ?.id にして安全性を向上

            let nextRankInfo = "---";
            if (myRank > 1) {
                const nextRankScore = allScores[myRank - 2].score;
                const diff = nextRankScore - myScore + 1;
                nextRankInfo = `次の順位まで：§f${diff}個`;
            } else if (allScores.length > 1) {
                nextRankInfo = "( •ө• )";
            } else {
                nextRankInfo = "独走中";
            }

            let myMoney = "§cエラー";
            const objectiveMoney = world.scoreboard.getObjective("money");
            if(!objectiveMoney){ // 修正: if check logic simplify
                myMoney = "§c不明";
            }
            else{
                myMoney = objectiveMoney.getScore(player) ?? 0;
            }

            // デイリー採掘数の取得
            const currentDateStr = getDailyDateString();
            const lastDateStr = player.getDynamicProperty(DAILY_MINING_DATE_PROP);
            let myDailyScore = 0;
            if (lastDateStr === currentDateStr) {
                const dailyObj = world.scoreboard.getObjective(DAILY_MINING_OBJECTIVE);
                myDailyScore = dailyObj?.getScore(player) ?? 0;
            }

            let message = "";
            if (mode === DISPLAY_MODE_SIMPLE) {
                 message = `§d採掘数: §f${myScore}個 §7| §g所持金: §f${myMoney}§7なこ`;
            } else {
                 // DISPLAY_MODE_ALL
                 message = `§d採掘数: §f${myScore}個 §7| §d順位: §f${myRank}位 §7| §d${nextRankInfo} §7| §g所持金: §f${myMoney}§7なこ`;
            }
            player.onScreenDisplay.setActionBar(message);
        }

        // cachedNameMap に変更があった場合のみ Dynamic Property に保存する
        if (isMapDirty) {
            world.setDynamicProperty(PLAYER_NAME_MAP_PROP, JSON.stringify(cachedNameMap));
        }

    } catch (e) {
        console.error(`[MiningRanking] Error in interval loop: ${e}`);
        sendLog(`定期処理エラー：${e}`);
    }
}, 20); // 20 ticks = 1秒


// --- コマンド処理関数 ---

/**
 * 現在のバージョンをプレイヤーに表示します。
 * @param {import("@minecraft/server").Player} player
 */
function showVersion(player) {
    try {
        player.sendMessage(`§a[MSS]§fMining Summary System v${BEHAVIOR_PACK_VERSION}`);
    } catch (e) {
        player.sendMessage("§a[MSS]§cバージョンの表示中にエラーが発生しました。");
        console.error(`[MiningRanking] Error in showVersion: ${e}`);
        sendLog(`バージョン表示エラー：${e}`);
    }
}

/**
 * 採掘数ランキングをプレイヤーに表示します。
 * @param {import("@minecraft/server").Player} player
 */
function showRank(player) {
    try {
        // 表示する前に日付切り替え判定（デイリーリセット）を行う
        checkWorldDailyReset();

        const objective = world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE);
        if (!objective) {
            player.sendMessage("§a[MSS]§cランキングデータを取得できませんでした。");
            return;
        }

        const scores = objective.getScores();
        scores.sort((a, b) => b.score - a.score);

        // cachedNameMap を使用する（毎回 getDynamicProperty + JSON.parse を起動するためここは必要）
        const nameMap = cachedNameMap ?? {};
        const onlinePlayers = world.getAllPlayers();

        /**
         * スコアボードの参加者情報からプレイヤー名を取得します。
         * オンラインプレイヤーは現在の名前を、オフラインプレイヤーは保存された名前を返します。
         * @param {import("@minecraft/server").ScoreboardIdentity} participant
         * @returns {string}
         */
        const getPlayerNameFromParticipant = (participant) => {
            // まずオンラインプレイヤーから探す
            const onlinePlayer = onlinePlayers.find(p => p.scoreboardIdentity?.id === participant.id);
            if (onlinePlayer) {
                return onlinePlayer.name;
            }
            // オフラインなら保存されたマップから探す
            if (nameMap[participant.id]) {
                return nameMap[participant.id];
            }
            // それでも見つからなければ、元の表示名を返すか、固定の文字列を返す
            return participant.displayName.startsWith("commands.") ? "(不明なオフラインプレイヤー)" : participant.displayName;
        };
        
        player.sendMessage("§a[MSS]§l§b--- 採掘数ランキング TOP10 ---");

        // 上位10名を表示
        const top10 = scores.slice(0, 10);
        top10.forEach((entry, index) => {
            const playerName = getPlayerNameFromParticipant(entry.participant);
            player.sendMessage(`§e${index + 1}位: §f${playerName} §7- §r${entry.score}個`);
        });

        player.sendMessage("§b--------------------");

        // 実行者の順位を表示
        const myScore = objective.getScore(player) ?? 0;
        const participantId = player.scoreboardIdentity?.id;
        const myRank = participantId ? scores.findIndex(s => s.participant.id === participantId) + 1 : 0;

        // デイリー採掘数の取得
        const currentDateStr = getDailyDateString();
        const lastDateStr = player.getDynamicProperty(DAILY_MINING_DATE_PROP);
        let myDailyScore = 0;
        if (lastDateStr === currentDateStr) {
            const dailyObj = world.scoreboard.getObjective(DAILY_MINING_OBJECTIVE);
            myDailyScore = dailyObj?.getScore(player) ?? 0;
        }

        if (myRank > 0) {
            player.sendMessage(`§aあなたの順位: ${myRank}位 (${myScore}個)`);
        } else {
            player.sendMessage("§aあなたはまだランク外です。");
        }
        player.sendMessage(`§a今日の採掘数: ${myDailyScore}個`);
    } catch (e) {
        player.sendMessage("§a[MSS]§cランキングの表示中にエラーが発生しました。");
        console.error(`[MiningRanking] Error in showRank: ${e}`);
        sendLog(`ランキング表示エラー：${e}`);
    }
}

/**
 * すべての採掘数ランキングをプレイヤーに表示します。
 * @param {import("@minecraft/server").Player} player
 */
function showRankAll(player) {
    try {
        const objective = world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE);
        if (!objective) {
            player.sendMessage("§a[MSS]§cランキングデータを取得できませんでした。");
            return;
        }

        const scores = objective.getScores();
        scores.sort((a, b) => b.score - a.score);

        // cachedNameMap を使用する（毎回の getDynamicProperty + JSON.parse を排除）
        const nameMap = cachedNameMap ?? {};
        const onlinePlayers = world.getAllPlayers();

        /**
         * スコアボードの参加者情報からプレイヤー名を取得します。
         * オンラインプレイヤーは現在の名前を、オフラインプレイヤーは保存された名前を返します。
         * @param {import("@minecraft/server").ScoreboardIdentity} participant
         * @returns {string}
         */
        const getPlayerNameFromParticipant = (participant) => {
            // まずオンラインプレイヤーから探す
            const onlinePlayer = onlinePlayers.find(p => p.scoreboardIdentity?.id === participant.id);
            if (onlinePlayer) {
                return onlinePlayer.name;
            }
            // オフラインなら保存されたマップから探す
            if (nameMap[participant.id]) {
                return nameMap[participant.id];
            }
            // それでも見つからなければ、元の表示名を返すか、固定の文字列を返す
            return participant.displayName.startsWith("commands.") ? "(不明なオフラインプレイヤー)" : participant.displayName;
        };
        
        player.sendMessage("§a[MSS]§l§b--- 採掘数ランキング ---");

        if (scores.length === 0) {
            player.sendMessage("§eランキングデータがありません。");
        } else {
            scores.forEach((entry, index) => {
                const playerName = getPlayerNameFromParticipant(entry.participant);
                player.sendMessage(`§e${index + 1}位: §f${playerName} §7- §r${entry.score}個`);
            });
        }

        player.sendMessage("§b--------------------");

        // 実行者の順位を表示（確認用）
        const myScore = objective.getScore(player) ?? 0;
        const myRank = player.scoreboardIdentity?.id
            ? scores.findIndex(s => s.participant.id === player.scoreboardIdentity.id) + 1
            : 0;

        if (myRank > 0) {
            player.sendMessage(`§aあなたの順位: ${myRank}位 (${myScore}個)`);
        }
    } catch (e) {
        player.sendMessage("§a[MSS]§cランキングの表示中にエラーが発生しました。");
        console.error(`[MiningRanking] Error in showRankAll: ${e}`);
        sendLog(`ランキング表示エラー：${e}`);
    }
}

/**
 * デイリー採掘数ランキングをプレイヤーに表示します。
 * スコアボード `daily_mining` から上位10名を取得してチャットに出力します。
 * @param {import("@minecraft/server").Player} player コマンドを実行またはコンパスを使用したプレイヤー
 */
function showDailyRank(player) {
    try {
        // 表示する前に日付切り替え判定（デイリーリセット）を行う
        checkWorldDailyReset();

        const objective = world.scoreboard.getObjective(DAILY_MINING_OBJECTIVE);
        if (!objective) {
            player.sendMessage("§a[MSS]§cデイリーランキングデータを取得できませんでした。");
            return;
        }

        // 参加者のスコアを取得し、降順（スコアが多い順）にソート
        const scores = objective.getScores();
        scores.sort((a, b) => b.score - a.score);

        // cachedNameMap を使用する（毎回の getDynamicProperty + JSON.parse を排除）
        const nameMap = cachedNameMap ?? {};
        const onlinePlayers = world.getAllPlayers();

        /**
         * スコアボードの参加者情報から表示するプレイヤー名を取得するヘルパー関数
         * オンラインプレイヤーは現在の名前、オフラインプレイヤーは保存された名前を使用します。
         */
        const getPlayerNameFromParticipant = (participant) => {
            // オンラインプレイヤーから検索
            const onlinePlayer = onlinePlayers.find(p => p.scoreboardIdentity?.id === participant.id);
            if (onlinePlayer) {
                return onlinePlayer.name;
            }
            // オフラインプレイヤーの場合は保存された名前マップから検索
            if (nameMap[participant.id]) {
                return nameMap[participant.id];
            }
            // いずれにもない場合はデフォルトの表示名またはプレースホルダー
            return participant.displayName.startsWith("commands.") ? "(不明なオフラインプレイヤー)" : participant.displayName;
        };
        
        player.sendMessage("§a[MSS]§l§b--- デイリー採掘数ランキング TOP10 ---");

        // 上位10名を取り出してチャットに表示
        const top10 = scores.slice(0, 10);
        if (top10.length === 0) {
            player.sendMessage("§e本日の採掘データはまだありません。");
        } else {
            top10.forEach((entry, index) => {
                const playerName = getPlayerNameFromParticipant(entry.participant);
                player.sendMessage(`§e${index + 1}位: §f${playerName} §7- §r${entry.score}個`);
            });
        }

        player.sendMessage("§b--------------------");

        // 実行した本人の今日の採掘数と順位を表示
        const myScore = objective.getScore(player) ?? 0;
        const participantId = player.scoreboardIdentity?.id;
        const myRank = participantId ? scores.findIndex(s => s.participant.id === participantId) + 1 : 0;

        if (myRank > 0) {
            player.sendMessage(`§aあなたの本日の順位: ${myRank}位 (${myScore}個)`);
        } else {
            player.sendMessage(`§aあなたの本日の採掘数: ${myScore}個 (ランク外)`);
        }
    } catch (e) {
        player.sendMessage("§a[MSS]§cデイリーランキングの表示中にエラーが発生しました。");
        console.error(`[MiningRanking] Error in showDailyRank: ${e}`);
        sendLog(`デイリーランキング表示エラー：${e}`);
    }
}



/**
 * ワールド全体の採掘統計をプレイヤーに表示します。
 * @param {import("@minecraft/server").Player} player
 */
function showSummary(player) {
    try {
        // 1. ワールド全体の総採掘数を取得
        const worldObjective = world.scoreboard.getObjective(WORLD_MINING_COUNT_OBJECTIVE);
        const totalMined = worldObjective?.getScore(WORLD_TOTAL_HOLDER) ?? 0;

        player.sendMessage("§a[MSS]§l§b--- ワールド採掘統計 ---");
        player.sendMessage(`§e総採掘数: §f${totalMined}個`);
        player.sendMessage("§b--------------------");


        // 2. ブロックごとの採掘数を取得
        const allProperties = world.getDynamicPropertyIds();
        const blockCounts = [];
        for (const propId of allProperties) {
            if (propId.startsWith(BLOCK_COUNT_PREFIX)) {
                const blockId = propId.substring(BLOCK_COUNT_PREFIX.length);
                const count = world.getDynamicProperty(propId);
                if (typeof count === 'number') {
                    blockCounts.push({ id: blockId, count: count });
                }
            }
        }

        // 採掘数でソート
        blockCounts.sort((a, b) => b.count - a.count);

        player.sendMessage("§l§b--- ブロック別採掘数 TOP10 ---");

        if (blockCounts.length === 0) {
            player.sendMessage("§eまだブロックは採掘されていません。");
            return;
        }

        // 上位10件を表示
        const top10 = blockCounts.slice(0, 10);
        top10.forEach((block, index) => {
            // "minecraft:" プレフィックスを削除して表示
            const displayName = block.id.replace("minecraft:", "");
            player.sendMessage(`§e${index + 1}位: §f${displayName} §7- §r${block.count}個`);
        });
        player.sendMessage("§b--------------------");

    } catch (e) {
        player.sendMessage("§a[MSS]§c統計の表示中にエラーが発生しました。");
        console.error(`[MiningRanking] Error in showSummary: ${e}`);
        sendLog(`統計表示エラー：${e}`);
    }
}

/**
 * データリセット要求を処理します。
 * @param {import("@minecraft/server").Player} player
 */
function handleResetRequest(player) {
    const now = Date.now();
    const lastRequestTime = resetRequests[player.id];

    if (lastRequestTime && (now - lastRequestTime) < RESET_CONFIRMATION_TIMEOUT) {
        // 10秒以内に再実行された場合
        executeReset();
        world.sendMessage(`§a[MSS]§r§l ${player.name}§c によってすべてのデータがリセットされました。`);
        world.playSound("random.anvil_land", player.location, { volume: 0.4, pitch: 1.0, players: world.getAllPlayers() });
        delete resetRequests[player.id]; // 正常にリセットされたのでタイムアウトをキャンセルするために削除
    } else {
        // 初回実行またはタイムアウト後の実行の場合
        resetRequests[player.id] = now;
        player.sendMessage("§a[MSS]§l§c警告: 本当にすべての採掘データをリセットしますか？");
        player.sendMessage(`§c実行するには、${RESET_CONFIRMATION_TIMEOUT / 1000}秒以内にもう一度コマンドを実行してください。`);
        player.sendMessage("§c※この操作は取り消せません※");

        // タイムアウト処理を設定
        system.runTimeout(() => {
            // タイムアウト後にまだリセット要求が存在するか確認
            if (resetRequests[player.id] === now) {
                // 修正２: 退出したプレイヤーにメッセージを送ろうとしてエラーになるケースを防ぐため isValid() チェック
                if (player.isValid()) {
                    player.sendMessage("§a[MSS]§r§eデータリセットがキャンセルされました。");
                }
                delete resetRequests[player.id];
            }
        }, RESET_CONFIRMATION_TIMEOUT / 1000 * 20); // 秒数をtickに変換 (20 ticks/sec)
    }
}

/**
 * すべてのランキングデータをリセットします。
 */
function executeReset() {
    try {
        // 1. プレイヤーごとの採掘数をリセット
        const miningObjective = world.scoreboard.getObjective(MINING_COUNT_OBJECTIVE);
        if (miningObjective) {
            for (const participant of miningObjective.getParticipants()) {
                miningObjective.removeParticipant(participant);
            }
        }

        const dailyObjective = world.scoreboard.getObjective(DAILY_MINING_OBJECTIVE);
        if (dailyObjective) {
            for (const participant of dailyObjective.getParticipants()) {
                dailyObjective.removeParticipant(participant);
            }
        }

        // デイリー最終更新日もリセット（オンラインプレイヤーのみ可能）
        for (const p of world.getAllPlayers()) {
            p.setDynamicProperty(DAILY_MINING_DATE_PROP, undefined);
        }

        // 2. ワールド全体の採掘数をリセット
        const worldObjective = world.scoreboard.getObjective(WORLD_MINING_COUNT_OBJECTIVE);
        if (worldObjective) {
            worldObjective.setScore(WORLD_TOTAL_HOLDER, 0);
        }

        // 3. ブロックごとの採掘数をリセット
        const allProperties = world.getDynamicPropertyIds();
        for (const propId of allProperties) {
            if (propId.startsWith(BLOCK_COUNT_PREFIX)) {
                world.setDynamicProperty(propId, undefined);
            }
        }
        
        // 4. プレイヤーIDと名前の対応表をリセット
        world.setDynamicProperty(PLAYER_NAME_MAP_PROP, undefined);
        // メモリ内キャッシュも同時にクリアする（古いデータの再利用を防ぐ）
        cachedNameMap = {};

        console.log("[MiningRanking] All data has been reset.");
    } catch (e) {
        console.error(`[MiningRanking] Failed to execute reset: ${e}`);
        world.sendMessage("§a[MSS]§cデータのリセット中にエラーが発生しました。");
        sendLog(`データリセットエラー：${e}`);
    }
}