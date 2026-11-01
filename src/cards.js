/**
 * 扑克牌基础操作
 * 牌的表示: { rank: 2-14, suit: 's'|'h'|'d'|'c' }
 * 14 = A, 13 = K, 12 = Q, 11 = J
 */

const SUITS = ['s', 'h', 'd', 'c']; // 黑桃 红心 方块 梅花
const RANK_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

/** 生成一副洗好的 52 张牌 */
function newDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ rank, suit });
    }
  }
  // Fisher-Yates 洗牌
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function rankName(rank) {
  return RANK_NAMES[rank] || String(rank);
}

/** 牌的短文本，如 "A♠" */
function cardText(card) {
  if (!card) return '';
  const suitSym = { s: '♠', h: '♥', d: '♦', c: '♣' }[card.suit];
  return rankName(card.rank) + suitSym;
}

module.exports = { newDeck, rankName, cardText };
