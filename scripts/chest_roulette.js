import { world, system } from "@minecraft/server";

// --- 設定 ---
const RouletteConfig = {
    // ルーレットの回転時間（tick）
    duration: 20, // 1秒 = 20 ticks
    
    // 金額の候補と重み（確率）
    // 重みの合計値に対する割合で確率が決まる
    rewards: [
        { amount: 1000, weight: 60 },  // 50/115 ≈ 43.5%
        { amount: 2000, weight: 20 },  // 30/115 ≈ 26.1%
        { amount: 3000, weight: 10 },  // 15/115 ≈ 13.0%
        { amount: 5000, weight: 6 },  // 10/115 ≈ 8.7%
        { amount: 10000, weight: 2 },  
    ]
};

// --- ヘルパー関数 ---

/**
 * 重み付きリストからランダムに1つの要素を選択します。
 * @returns {number} 当選した金額
 */
function getRandomReward() {
    const totalWeight = RouletteConfig.rewards.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const item of RouletteConfig.rewards) {
        if (random < item.weight) {
            return item.amount;
        }
        random -= item.weight;
    }
    return RouletteConfig.rewards[0].amount; // フォールバック
}

/**
 * 宝箱ルーレットを開始します。
 * @param {import("@minecraft/server").Player} player 
 */
export function startChestRoulette(player) {
    // メインのインベントリを取得
    const inventory = player.getComponent("inventory").container;
    
    // 手持ちのアイテムを確認（宝箱であることを確認して減らす）
    // NOTE: itemUseイベントから呼ばれるため、厳密には手持ちが宝箱であるはずだが、
    // 念のため確認し、減らす処理を行う
    const selectedSlot = player.selectedSlotIndex;
    const item = inventory.getItem(selectedSlot);
    
    if (!item || item.typeId !== "mss:nakoiribukuro") {
        return; // 念のため
    }
    
    // アイテムを1つ減らす
    if (item.amount > 1) {
        item.amount -= 1;
        inventory.setItem(selectedSlot, item);
    } else {
        inventory.setItem(selectedSlot, undefined);
    }
    
    const finalAmount = getRandomReward();
    let currentTick = 0;
    
    // ルーレット実行
    const runId = system.runInterval(() => {
        currentTick++;
        
        // ルーレット演出：ランダムな数字を表示
        if (currentTick < RouletteConfig.duration) {
            // パラパラ表示するダミーの金額
            const dummyInfo = RouletteConfig.rewards[Math.floor(Math.random() * RouletteConfig.rewards.length)];
            const color = dummyInfo.amount >= 10000 ? "§e" : (dummyInfo.amount >= 5000 ? "§6" : "§f");
            
            player.onScreenDisplay.setTitle(`${color}${dummyInfo.amount} §7なこ`, {
                fadeInDuration: 0,
                stayDuration: 2,
                fadeOutDuration: 0,
                subtitle: ""
            });
            
            // 音を鳴らす
            player.playSound("random.click", { pitch: 1.5 + Math.random() * 0.5 });
        } 
        // 結果発表
        else {
            system.clearRun(runId);
            
            const color = finalAmount >= 10000 ? "§e§l" : (finalAmount >= 5000 ? "§6§l" : "§f§l");
            
            // 画面に大きく表示
            player.onScreenDisplay.setTitle(`${color}${finalAmount} §7なこ`, {
                fadeInDuration: 0,
                stayDuration: 60,
                fadeOutDuration: 20,
                subtitle: "§eを手に入れた！"
            });
            
            // スコアボードにお金を追加
            try {
                const objective = world.scoreboard.getObjective("money");
                if (objective) {
                    objective.addScore(player, finalAmount);
                } else {
                    player.sendMessage("§c[エラー] moneyスコアボードが見つかりません。");
                }
            } catch (e) {
                console.error(`Failed to add money: ${e}`);
            }
            
            // 演出
            if (finalAmount >= 10000) {
                player.playSound("random.levelup", { pitch: 1.0 });
                player.dimension.spawnEntity("minecraft:fireworks_rocket", player.location);
                // 全体チャットでお祝い表示
                world.sendMessage(`§a[MSS]§f§l§k!!!§r §b${player.name}§f が §dなこ入り袋§f から§e${finalAmount}なこ§f を獲得しました！ §k!!!§r`);
            } else {
                player.playSound("random.orb", { pitch: 1.0 });
            }
            
            player.sendMessage(`§a[MSS] §eなこ入り袋から §f${finalAmount}なこ §e手に入れた！`);
        }
    }, 1); // 1 tickごとに実行
}
