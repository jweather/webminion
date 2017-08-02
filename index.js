// WebMinion 0.0

/*
phase 1
 - fix Bureaucrat and Bandit to give other players a choice of what to discard via showPopup
 - random AI
 - show Curse card supply numbers
 - help button to show card description
 - handle more than 9 hand cards -- scroll?  two rows?
 - handle more than X cards in popup
 - unify single/multi selection logic

phase 2
 - refactor Game, Player, UI classes
 - networked multiplayer
 - more players

future
 - should I put in the 1st edition base cards as an option?
 - port vdom AIs
 - animate card drawing, buying, discarding, trashing
  
*/


// constants
var cancelable = true;
var notCancelable = false;

// static data
var allCards = [];
var C = {}; // card prototypes
var allPacks = ['Base'];
var specialHandler = {};

// this game
var activeCards = [];	// the 10 market cards, needs a better name
var supply = [];
var supplyByName = {};
var trash = [];

var players = [];
var nPlayers = 0;

var player = null;
var whoseTurn = 0;
var turn = {}; // progress of current turn

// used by event handlers
var selecting = null;

// debug / fault injection
var endPrematurely = false;

function d(msg) { console.log(msg); }
function assert(what, why) {
	if (what) return;
	var msg = 'Assertion failed: ' + why;
	if (!what) console.log(msg);
	alert(msg);
	throw(msg);
}

function shuffle(array) {
	// Durstenfeld
	for (var i = array.length - 1; i > 0; i--) {
			var j = Math.floor(Math.random() * (i + 1));
			var temp = array[i];
			array[i] = array[j];
			array[j] = temp;
	}
	return array;
}

$(window).load(function() {
	$('.confirm').prop('disabled', true);
	$('.cancel').prop('disabled', true);
	
	d('loading card data...');
	$.get('data/cards.json5', function(res) {
		d('parsing card data...');
		var data = JSON5.parse(res);
		var issues = [];
		var actions = 0;
		data.cards.forEach(function(card) {
			if (card.special && !specialHandler[card.name]) card.unimplemented = true;
			if (card.unimplemented) { 
				issues.push(card.name + ' is not implemented'); return; 
			}
			if (!card.desc && card.pack != 'Core') issues.push(card.name + ' has no description');
			assert(!C[card.name], card.name + ' duplicate name');
			assert(card.pack == 'Core' || allPacks.includes(card.pack), card.name + ' unknown pack name');
			
			// set default backgrounds
			if (!card.bg && card.reaction) card.bg = '#0000ff';
			if (!card.bg && card.type == 'Victory') card.bg = '#008800';
			if (!card.bg) card.bg = '#888888';
			
			allCards.push(card);
			C[card.name] = card;
			if (card.type == 'Action') actions++;
		});
		d('read in ' + allCards.length + ' cards, ' + actions + ' actions, ' + issues.length + ' issues');
		console.log(issues);
		log('got card data, ' + issues.length + ' issues');
		
		newGame();
	});
	
	// events
	$('#main').on('click', '.card:not(.fake)', function() {
		var card = $(this).data('card'); // remember this is a clone of the original data
		
		d('click ' + card.loc + ' card ' + card.name);
		// check filter, check count, toggle highlight
		if (!selecting) return;
		if (selecting.loc != card.loc) return;
		
		if (selecting.filter) {
			if (!selecting.filter(card)) return;
		}
		
		if (selecting.multi != null) {
			var idx = $(this).data('index');
			var i = selecting.index.indexOf(idx);
			if (i != -1) {
				// deselect
				selecting.index.splice(i, 1);
				selecting.card.splice(i, 1);
				
				$('.card:not(.fake)').each(function(i,e) {
					var id = $(e).data('index');
					if (id == idx) $(e).removeClass('sel');
				});
			} else if (selecting.index.length == selecting.multi) {
				return; // at max count
			} else {
				selecting.index.push(idx);
				selecting.card.push(card);
				$(this).addClass('sel');
			}
			$('.confirm').prop('disabled', selecting.index.length < selecting.multiMin);
			
		} else {
			$('.card:not(.fake)').removeClass('sel')
			$(this).addClass('sel');

			selecting.card = card;
			selecting.index = $(this).data('index'); // needed for duplicate cards in hand
			$('.confirm').prop('disabled', false);
		}
	});

	$('.cancel').on('click', function() {
		$('#popup').fadeOut();

		$('.confirm').prop('disabled', true);
		$('.cancel').prop('disabled', true);
		var s = selecting; selecting = null;
		s.cb(null, null, 'Cancel');
	});

	$('#main').on('click', '.confirm', function() {
		if (selecting.card == null || (selecting.multi && selecting.card.length == 0)) return;
		$('#popup').fadeOut();

		$('.confirm').prop('disabled', true);
		$('.cancel').prop('disabled', true);
		var s = selecting; selecting = null;
		s.cb(s.card, s.index, $(this).data('action'));
	});
	
	$('#discard').on('click', function() {
		d('click discard pile');
		showPopup(whoseTurn, 'Browse discard pile', 'Close', player.discard, cancelable, {selectMax: 0}, function() {
			d('closed');
		});
	});
	
	$('#popup .close').on('click', function() {
		$('#popup').fadeOut();
		if (selecting) {
			selecting.cb(null, null, 'Cancel');
			selecting = null;
		}
	});
});

function showPopup(pi, title, action, cards, cancelable, options, cb) {
	var p = players[pi];
	title = p.name + ': ' + title;
	$('#popup .title').text(title);
	$('#popup .body').html('');

	if (cards != null) {
		cards = cards.map(function(c) { var c2 = clone(c); c2.loc = 'popup'; return c2; });
		var row = cardRow(cards);
		if (cards.length == 0)
			row.append($('<div/>').addClass('fakeCard').text('[Empty]'));
		$('#popup .body').append(row);
	}
	
	if (action) {
		$('.confirm').text(action);
		$('.confirm').data('action', action);
		$('.confirm').show();
	} else {
		$('.confirm').hide();
	}

	// alternate confirm buttons?
	if (options.buttons) {
		options.buttons.forEach(function(a) {
			var btn = $('<button/>').addClass('btn').addClass('confirm').data('action', a).text(a);
			$('#popup .body').append(btn);
		});
	}
	
	$('.confirm').prop('disabled', true);

	$('.cancel').prop('disabled', !cancelable);
	$('#popup .close').toggle(cancelable);
	
	if (options.selectMin == undefined) options.selectMin = 1;
	selecting = {cb: cb, card: null, index: 0, filter: any, loc: 'popup', 
		multi: options.selectMax, multiMin: options.selectMin};
		
	if (selecting.multi) {
		selecting.card = []; selecting.index = [];
	}

	$('#popup').fadeIn();
}

// classes
var Player = function Player(name) {
	this.name = name;
	this.ai = false;
	this.hand = [];
	this.deck = [];
	this.discard = [];
	this.trash = trash; // everybody uses one trash pile
	
	this.notifyCB = [];
}
Player.prototype.notify = function(what) {
	this.notifyCB.forEach(function(f) {
		f(what);
	});
}
Player.prototype.gain = function(cp, dest) {
	if (!dest) dest = 'discard'; // default destination
	var card = clone(cp);
	card.loc = dest; card.played = false;
	this[dest].push(card);
	this.notify(dest);
}

// card probably came from peekCards
Player.prototype.move = function(card, dest) {
	card.loc = dest; card.played = false;
	if (dest == 'deck') {
		this.deck.unshift(card);
	} else {
		this[dest].push(card);
	}
	this.notify(dest);
}

Player.prototype.gainFromSupply = function(cp, dest) {
	var scard = supplyByName[cp.name];
	scard.supply--;
	renderSupply();
	
	this.gain(cp, dest);
}
Player.prototype.moveHandCardTo = function(idx, dest) {
	var card = this.hand[idx];
	this.hand.splice(idx, 1);
	
	card.loc = dest; card.played = false;
	if (dest == 'deck')
		this.deck.unshift(card); // card goes on top
	else
		this[dest].push(card);
	this.notify('hand');
	this.notify(dest);
}

Player.prototype.reshuffleIfNeeded = function() {
	if (this.deck.length == 0) {
		if (this.discard.length == 0) {
			d('No cards left to draw for ' + this.name);
			return;
		}
		this.deck = this.discard; this.discard = [];
		this.deck.forEach(function(c) { c.loc = 'deck'; });
		shuffle(this.deck);
		this.notify('discard');
	}
}	

Player.prototype.peekCard = function() {
	this.reshuffleIfNeeded();
	if (this.deck.length == 0) return null; // unusual but possible
	var card = this.deck.shift();
	return card;
}
Player.prototype.peekCards = function(count) {
	var cards = [];
	for (var i=0; i<count; i++) {
		cards.push(this.peekCard());
	}
	return cards;
}
Player.prototype.peekHandIndex = function(idx) {
	var card = this.hand[idx];
	this.hand.splice(idx, 1);
	this.notify('hand');
	return card;
}

Player.prototype.drawCard = function() {
	this.reshuffleIfNeeded();
	var card = this.peekCard();
	this.move(card, 'hand');
}
Player.prototype.drawCards = function(count) {
	for (var i=0; i<count; i++) {
		this.drawCard();
	}
}
Player.prototype.cleanup = function() {
	while (this.hand.length) {
		var card = this.hand.shift();
		card.played = false; card.loc = 'discard';
		this.discard.push(card);
	}
	this.drawCards(5);
}


Player.prototype.playHandIndex = function(handIndex, cb) {
	var card = player.hand[handIndex];
	card.played = true;
	this.notify('hand');
	
	this.play(card, cb);
}

Player.prototype.play = function(card, cb) {
	log(this.name + ' plays ' + card.name);
	
	if (card.addActions)	turn.actions += card.addActions;
	if (card.addBuys)			turn.buys += card.addBuys;
	if (card.addCoins)		turn.coins += card.addCoins;
	if (card.addCards) 		this.drawCards(card.addCards);

	if (card.special) {
		specialHandler[card.name](cb);
	} else {
		cb();
	}
}

// game flow
function newGame() {
	// todo: select players
	nPlayers = 2;
	
	whoseTurn = -1; // don't try to render a hand before the players exist
	
	// starting decks
	for (var i=0; i<nPlayers; i++) {
		var p = new Player('Player ' + i);
		for (j=0; j<3; j++) { p.gain(C.Estate); }
		for (j=0; j<7; j++) { p.gain(C.Copper); }
		
		function makeCB(i) { return function() { renderHand(i); } }
		p.notifyCB.push(makeCB(i));
		
		p.drawCards(5);
		
		players.push(p);
	}
	
	whoseTurn = 0;
	player = players[whoseTurn];
	renderHand(whoseTurn);
	
	// defaults for 2 players
	var supplyCounts = {Copper: 60, Silver: 40, Gold: 30, Estate: 8, Duchy: 8, Province: 8, Curse: (nPlayers-1)*10};
	var supplyGardens = 12;
	
	if (nPlayers >= 3) {
		supplyCounts.Estate = 12;
		supplyCounts.Duchy = 12;
		supplyCounts.Province = 12;
		supplyGardens = 12;
	}
	
	if (nPlayers == 5 || nPlayers == 6) {
		// double all Base cards
		supplyCounts.Copper = 120;
		supplyCounts.Silver = 80;
		supplyCounts.Gold = 60;
		if (nPlayers == 5) {
			supplyCounts.Province = 15;
		} else if (nPlayers == 6) {
			supplyCounts.Province = 18;
		}
	}
	
	// todo: select packs
	var packs = allPacks;
	
	// todo: preset games, or repeat last game

	// randomly select Action cards for supply piles
	var cand = [];
	allCards.forEach(function(card) {
		if (!packs.includes(card.pack)) return;
		cand.push(card.name);
	});
	assert(cand.length >= 10, 'Not enough action cards for a market');
	shuffle(cand);
	
	// cheat
	cand.unshift('Militia'); cand.unshift('Moat');
	
	// set up supply
	supply = [];
	Object.keys(supplyCounts).forEach(function(cn) {
		var card = clone(C[cn]);
		card.loc = 'supply';
		card.supply = supplyCounts[cn];
		supply.push(card);
		supplyByName[card.name] = card;
	});
	
	for (var i=0; i<10; i++) {
		var card = clone(C[cand.shift()]);
		card.loc = 'supply';
		card.supply = 10;
		if (card.name == 'Gardens') card.supply = supplyGardens;
		supply.push(card);
		supplyByName[card.name] = card;
		activeCards.push(card);
	}
	activeCards = activeCards.sort(function(a,b) {
		if (a.cost < b.cost) return -1;
		if (a.cost > b.cost) return 1;
		if (a.name < b.name) return -1;
		if (a.name > b.name) return 1;
		return 0;
	});
	
	newTurn();
}

function newTurn() {
	$('#hand').fadeOut(function() {
		$('#hand').html('');
		$('#hand').show();
		
		turn = {actions: 1, buys: 1, coins: 0, phase: 'Action'};
		player.turns++;
		
		d('===turn start for ' + whoseTurn);
		renderSupply();
		renderHand(whoseTurn);
		phaseAction();
	});
}

function phaseAction() {
	turn.phase = 'Action';
	renderTurn();
	
	var canPlay = function(c) { return c.type == 'Action' && !c.played; }
		
	var actions = player.hand.filter(canPlay);
	if (turn.actions == 0 || actions.length == 0) {
		d('no more actions');
		phaseBuy();
	} else {
		selectHand(whoseTurn, 'Select an action from your hand', 'Play', canPlay, cancelable, function(c, index) {
			if (c == null) return phaseBuy();
			turn.actions--;

			player.playHandIndex(index, function() {
				renderTurn();
				phaseAction();
			});
		});
	}
}

function phaseBuy() {
	if (turn.phase != 'Buy') {
		d('entering buy phase with ' + turn.coins + ' coins from actions');
		turn.coins += sumTreasureCoins(player.hand);
		turn.phase = 'Buy';
	}
	renderTurn();
	
	if (turn.buys == 0) {
		phaseCleanup();
	} else {
		selectSupply(whoseTurn, 'Choose a card to buy, up to ' + turn.coins + ' coins', 'Buy', buyable(turn.coins), 
			cancelable, function(card) {
			if (card == null) return phaseCleanup();
			
			log(player.name + ' buys ' + card.name);
			
			player.gainFromSupply(card);
			
			turn.coins -= card.cost;
			turn.buys--;
			
			phaseBuy();
		});
	}
}

function phaseCleanup() {
	// change first so we don't see the cleanup for the last player
	whoseTurn = (whoseTurn + 1) % players.length;

	player.cleanup(); // discard hand and discarding cards
	
	player = players[whoseTurn];

	if (gameEnding() || endPrematurely) {
		alert("It's the end of the game as we know it.");
		players.forEach(function(p) {
			p.points = 0;
			var deck = p.hand.concat(p.discard).concat(p.deck);
			var gardenPoints = Math.floor(deck.length / 10);
			deck.forEach(function(cn) {
				var c = C[cn];
				if (c.points) p.points += c.points;
				if (c.name == 'Gardens') p.points += gardenPoints;
			});
			d(p.name + ' has ' + p.points + ' points');
		});
		
		return;
	}
	newTurn();
}

// game logic
function emptySupplyPiles() {
	var empty = 0;
	Object.keys(supply).forEach(function(cn) {
		if (supply[cn].supply == 0) empty++;
	});
	return empty;
}

function gameEnding() {
	var requiredEmpty = 3;
	if (nPlayers >= 5) requiredEmpty = 4;
	return (emptySupplyPiles() >= requiredEmpty || supply.Province == 0);
}

function sumTreasureCoins(hand) {
	var sum = 0;
	var merchants = 0, silver = false;
	hand.forEach(function(card) {
		if (card.type == 'Treasure') {
			sum += card.coins;
			if (card.name == 'Silver') silver = true;
		}
		if (card.name == 'Merchant' && card.played) merchants++;
	});
	if (silver && merchants > 0) {
		log('Merchant bonus +' + merchants + ' for silver');
		sum += merchants;
	}
	return sum;
}

function beginSelect(who, reason, action, filter, cancelable, loc, cb) {
	selecting = {cb: cb, card: null, index: 0, filter: filter, loc: loc};
	$('#turn').text(players[who].name);
	$('#prompt').text(reason);
	
	$('.cancel').prop('disabled', !cancelable);

	$('.confirm').prop('disabled', true);
	$('.confirm').text(action);
	$('.confirm').show();
	
	$('.card:not(.fake)').removeClass('sel').removeClass('gray');
	// gray out cards that don't match the filter
	$('.card:not(.fake)').each(function(i, e) {
		var card = $(e).data('card');
		$(e).toggleClass('gray', card.loc != loc || !filter(card));
	});
}

// card filter functions
function any() { return true; }
function none() { return false; }

function and() {
	var args = arguments;
	return function(c) {
		for (var i=0; i<args.length; i++) {
			if (!args[i](c)) return false;
		}
		return true;
	}
}

function isAction(c) {
	return c.type == 'Action';
}

function buyable(coins) {
	return function(c) {
		return c.cost <= coins;
	};
}

function notPlayed(c) {
	return !c.played;
}

function supplyAvailable(c) {
	return c.supply > 0;
}

function selectHand(who, reason, action, filter, cancelable, cb) {
	beginSelect(who, reason, action, and(notPlayed, filter), cancelable, 'hand', cb);
}

function selectSupply(who, reason, action, filter, cancelable, cb) {
	beginSelect(who, reason, action, and(supplyAvailable, filter), cancelable, 'supply', cb);
}

function selectHandMulti(who, reason, action, filter, cancelable, maxCount, cb) {
	beginSelect(who, reason, action, and(notPlayed, filter), cancelable, 'hand', cb);
	selecting.multi = options.selectMax;
	selecting.multiMin = options.selectMin;
	selecting.card = [];
	selecting.index = [];  // multiple selection
}

// special card handlers
// returns false to the callback if user canceled action -- but card was still played
// can't undo things like drawing cards, so it's a soft cancel
specialHandler.Artisan = function(cb) {
	selectSupply(whoseTurn, 'Select a card worth up to 5', 'Select', buyable(5), cancelable, function(card) {
		if (card == null) return cb(false);
		player.gainFromSupply(card, 'hand');
		log(player.name + ' Artisan gains ' + card.name);
		
		selectHand(whoseTurn, 'Select a card from your hand to put on top of your deck', 'Select', any, 
			cancelable, function(card, idx) {
			if (cn != null) {
				player.moveHandCardTo(idx, 'deck');
				log(player.name + ' Artisan moves ' + card.name + ' to deck top');
			}
			cb(true);
		});
	});
}

specialHandler.Bandit = function(cb) {
	player.gainFromSupply(C.Gold);
	for (var pi=0; pi<nPlayers; pi++) {
		if (pi == whoseTurn) continue;
		var p = players[pi];
		
		if (p.hand.some(function(c) { return c.name == 'Moat' })) {
			log(p.name + ' shows a Moat to protect against the Bandit');
			continue;
		}
		
		var cards = p.peekCards(2);
		var sortby = ['Gold', 'Silver'];
		
		// sort the cards such that Silver is first, then Gold, then everything else
		// todo: is there any reason to let the player choose?
		cards = cards.sort(function(a,b) { return compareRev(sortby.indexOf(a.name), sortby.indexOf(b.name)); });
		if (cards[0].name == 'Silver' || cards[0].name == 'Gold') {
			log(p.name + ' loses a ' + cards[0].name + ' to ' + player.name + "'s Bandit");
			trash.push(card[0]);
		} else {
			log(p.name + ' shows a ' + cards[0].name + ' and ' + cards[1].name + ' for the Bandit');
			p.move(cards[0], 'discard');
		}
		p.move(cards[0], 'discard');
	}
	cb();
}

specialHandler.Bureaucrat = function(cb) {
	player.gainFromSupply(C.Silver, 'deck'); // onto deck
	
	for (var pi=0; pi<nPlayers; pi++) {
		if (pi == whoseTurn) continue;
		var p = players[pi];

		if (p.hand.some(function(c) { return c.name == 'Moat' })) {
			log(p.name + ' shows a Moat to protect against the Bureaucrat');
			continue;
		}
		
		// todo: allow other player to choose which to discard
		var sortby = ['Province', 'Duchy', 'Estate'];
		
		var cards = p.hand.sort(function(a,b) { return compareRev(sortby.indexOf(a.name), sortby.indexOf(b.name)); });

		if (cards[0].type != 'Victory') {
			log(p.name + ' has no Victory cards to discard');
		} else {
			var idx = p.hand.find(x => x.name == cards[0].name);
			log(p.name + ' discards ' + cards[0].name);
			p.moveHandCardTo(idx, 'discard');
		}
	}
	cb(true);
}

specialHandler.Cellar = function(cb) {
	selectHandMulti(whoseTurn, 'Select 1-4 cards to discard and replace', 'Discard', any, cancelable, {selectMax: 4}, function(unused, indexes) {
		if (indexes.length == 0) return cb(false);
		var count = indexes.length;
		log(player.name + ' Cellar discards ' + count + ' cards');
		indexes.reverse().forEach(function(i) {
			player.moveHandCardTo(i, 'discard');
		});
		player.drawCards(count);
		cb(true);
	});
}

specialHandler.Chapel = function(cb) {
	selectHandMulti(whoseTurn, 'Select 1-4 cards to trash', 'Trash', any, cancelable, {selectMax: 4}, function(unused, indexes) {
		if (indexes.length == 0) return cb(false);
		var count = indexes.length;
		log(player.name + ' Chapel trashes ' + count + ' cards');
		indexes.reverse().forEach(function(i) {
			player.moveHandCardTo(i, 'trash');
		});
		player.drawCards(count);
		cb(true);
	});
}	

specialHandler['Council Room'] = function(cb) {
	for (var i=0; i<players.length; i++) {
		if (i == whoseTurn) continue;
		players[i].drawCard();
	}
	cb();
}

specialHandler.Harbinger = function(cb) {
	showPopup(whoseTurn, 'Harbinger: select a card to put on top of deck', 'Move', player.discard, cancelable, {}, function(card, index) {
		if (card == null) { 
			log('Harbinger was canceled');
			return cb(false);
		}
		card = player.discard[index];
		player.discard.splice(index, 1); player.notify('discard');
		player.move(card, 'deck');
		log(player.name + ' Harbinger moved ' + card.name + ' to top of deck');
		cb(true);
	});
}

specialHandler.Library = function(cb) {
	var setAside = [];
	function drawUp(cb) {
		if (player.hand.length >= 7) return cb(true);
		var card = player.peekCard();
		if (card == null) {
			log('No more cards available for Library');
			return cb();
		}
		if (card.type == 'Action') {
			// todo: pretty this up
			var resp = confirm('Drew ' + card.name + ': OK to keep, Cancel to discard');
			if (resp) {
				log(player.name + ' Library draws and keeps ' + card.name);
				player.move(card, 'hand');
			} else {
				log(player.name + ' Library draws and discards ' + card.name);
				setAside.push(card);
			}
		} else {
			log(player.name + ' Library draws ' + card.name);
			player.move(card, 'hand');
		}
		drawUp(cb);
	}
	
	drawUp(function() {
		setAside.forEach(function(card) {
			player.move(card, 'discard');
		});
		cb(true);
	});
}

specialHandler.Militia = function(cb) {
	turn.coins += 2;
	function militia(poff) {
		if (poff == nPlayers) return cb(true);
		var pi = (whoseTurn+poff) % nPlayers, p = players[pi];
		
		if (p.hand.find(c => c.name == 'Moat')) {
			log(p.name + ' defends against the Militia with a Moat');
			return militia(poff+1);
		}
		
		var excess = p.hand.length - 3;
		
		if (excess <= 0) {
			log(p.name + " doesn't need to discard any to the Militia");
			return militia(poff+1);
		}
		showPopup(pi, 'Militia: select ' + excess + ' card(s) to discard', 'Discard', p.hand, notCancelable, {selectMax: excess, selectMin: excess}, 
			function(cards, indexes) {
			if (cards.length < excess) return militia(poff); // keep trying
			indexes.reverse().forEach(function(ci) {
				log('Militia forces ' + p.name + ' to discard ' + p.hand[ci].name);
				p.moveHandCardTo(ci, 'discard');
			});
			militia(poff+1);
		});
	}
	militia(1);
}

specialHandler.Mine = function(cb) {
	selectHand(whoseTurn, 'Select a Treasure to upgrade +3', 'Upgrade', 
		function(c) { return c.name == 'Copper' || c.name == 'Silver' }, cancelable, function(c, idx) {
		if (c == null) return cb(false);
		player.moveHandCardTo(idx, 'trash');
		log(player.name + ' Mine upgrades ' + card.name);
		
		if (c.name == 'Copper') player.gainFromSupply(supplyByName.Silver, 'hand');
		if (c.name == 'Silver') player.gainFromSupply(supplyByName.Gold, 'hand');
		cb(true);
	});
}

specialHandler.Moneylender = function(cb) {
	selectHand(whoseTurn, 'Select a Copper to trash for +3 coins', 'Trash', 
		function(c) { return c.name == 'Copper' }, cancelable, function(c, idx) {
		if (c == null) return cb(false);
		player.moveHandCardTo(idx, 'trash');
		turn.coins += 3;
		cb(true);
	});
}

specialHandler.Poacher = function(cb) {
	function poach(n, cb) {
		if (n == 0) return cb();
		if (player.hand.filter(c => c.played == false).length == 0) {
			log('Not enough cards remaining for Poacher to discard');
			return cb();
		}
		selectHand(whoseTurn, 'Select a card to discard for Poacher', 'Discard', any, notCancelable, function(c, idx) {
			player.moveHandCardTo(idx, 'discard');
			n--;
			poach(n, cb);
		});
	};
	
	var poaching = emptySupplyPiles();
	if (poaching)
		log(player.name + ' Poacher requires ' + poaching + ' discard(s)');
	poach(poaching, cb);
}

specialHandler.Remodel = function(cb) {
	selectHand(whoseTurn, 'Select a card to upgrade +2', 'Upgrade', any, cancelable, function(c, idx) {
		if (c == null) return cb(false);
		player.moveHandCardTo(idx, 'trash');
		var coins = c.cost + 2;
		selectSupply(whoseTurn, 'Select a card worth up to ' + coins, 'Select', buyable(coins), cancelable, function(c2) {
			if (c2 == null) return cb(false);
			log(player.name + ' Remodels a ' + c.name + ' into a ' + c2.name);
			player.gainFromSupply(c2);
			cb(true);
		});
	});
}

specialHandler.Sentry = function(cb) {
	var peek = player.peekCards(2);
	function sentry() {
		showPopup(whoseTurn, 'Sentry: select a card and an action',
			null, peek, cancelable, {buttons: ['Discard', 'Trash', 'Deck']},
			function(card, index, button) {
				if (card == null || button == 'Cancel') {
					peek.forEach(function(c) {
						player.move(c, 'deck');
					});
					return cb(false);
				}
				
				if (card.name != peek[0].name) { peek = peek.reverse(); } // swap if they picked the other one
				card = peek.shift();
			
				log('Sentry for ' + card.name + ' == ' + button);
				if (button == 'Discard')
					player.move(card, 'discard');
				if (button == 'Trash')
					player.move(card, 'trash');
				if (button == 'Deck')
					player.move(card, 'deck');
				if (peek.length > 0) return sentry();
				cb(true);
			});
	}
	sentry();
}

var pendingThroneRooms = 0;

specialHandler['Throne Room'] = function(cb) {
	function throneRoom(cb) {
		selectHand(whoseTurn, 'Select an Action to play twice', 'Play', isAction, cancelable, function(c, idx) {
			if (c == null) return cb(false);

			var card = player.peekHandIndex(idx); // remove it from player's hand, but don't discard it yet
			
			if (c.name == 'Throne Room') {
				log('Trying to break the game, huh?');
				// book says you get to play one action 2x, then another one 2x, not one 4x or four 2x
				pendingThroneRooms++;
				return throneRoom(cb);
			}
			
			log(player.name + ' uses Throne Room to play ' + card.name + ' twice');
			player.play(card, function() {
				player.play(card, function() {
					player.move(card, 'discard');
					if (pendingThroneRooms) {
						pendingThroneRooms--;
						return throneRoom(cb);
					}
					return cb(true);
				});
			});
		});
	}
	throneRoom(cb);
}

specialHandler.Vassal = function(cb) {
	var card = player.peekCard();
	if (card.type == 'Action') {
		var resp = confirm('Vassal drew ' + card.name + ': OK to play, Cancel to discard');
		if (resp) {
			log(player.name + ' Vassal drew and is playing ' + card.name);
			player.play(card, function() {
				player.move(card, 'discard');
				cb(true);
			});
		} else {
			player.move(card, 'discard');
			cb(true);
		}
	} else {
		log(player.name + ' Vassal discards ' + card.name);
		player.move(card, 'discard');
		cb(true);
	}
}

specialHandler.Witch = function(cb) {
	// in turn order from current player
	for (var poff=1; poff<nPlayers; poff++) {
		var pi = (whoseTurn+poff)%nPlayers;
		if (supplyByName.Witch.supply == 0) {
			log(player.name + ' Witch ran out of Curse cards');
			break;
		}
		players[pi].gainFromSupply(C.Curse);
	}
	cb(true);
}

specialHandler.Workshop = function(cb) {
	selectSupply(whoseTurn, 'Select a card worth up to 4', 'Select', buyable(4), cancelable, function(c) {
		if (c == null) return cb(false);
		log(player.name + ' Workshop gains ' + card.name);
		player.gainFromSupply(c);
		cb(true);
	});
}
	
function renderCard(card) {
	var e = $('<div/>').addClass('card');
	e.css({backgroundColor: card.bg});
	
	e.append($('<div/>').addClass('label').text(card.name));
	e.append($('<div/>').addClass('cost').text(card.cost));
	if (card.addActions)
		e.append($('<div/>').addClass('actions').text('+' + card.addActions));
	if (card.loc == 'supply') {
		e.append($('<div/>').addClass('supply').text(card.supply));
		if (card.supply == 0)
			e.addClass('empty');
	}
	if (card.type == 'Treasure')
		e.append($('<div/>').addClass('treasure').text(card.coins));
	if (card.short)
		e.append($('<div/>').addClass('short').html(card.short));
	
	e.data('card', card);
	
	return e;
}
function cardRow(cards) { 
	var row = $('<div/>').addClass('cardRow');
	for (var i=0; i<cards.length; i++) {
		var card = cards[i];
		var e;
		if (card == null)
			e = $('<div/>').addClass('blank').html('&nbsp;');
		else {
			e = renderCard(card);
			if (card.played == true)
				e.addClass('played');
		}
		e.data('index', i); // needed for duplicate cards in hand
		row.append(e);
	}
	return row;
}

function renderSupply() {
	$('#supply').html('');
	
	var row1 = [supplyByName.Copper, supplyByName.Silver, supplyByName.Gold, null].concat(activeCards.slice(0, 5));
	$('#supply').append(cardRow(row1));
	
	var row2 = [supplyByName.Estate, supplyByName.Duchy, supplyByName.Province, null].concat(activeCards.slice(5, 10));
	$('#supply').append(cardRow(row2));
}

function renderHand(pi) {
	if (pi != whoseTurn) return;
	
	$('#hand').html('');
	$('#hand').append(cardRow(player.hand));
	$('#discard .supply').text(player.discard.length);
	$('#deck .supply').text(player.deck.length);
}

function renderTurn() {
	$('#status').html(turn.actions + ' actions, <div class="cost">' + turn.coins + '</div> coins' + ', ' + turn.buys + ' buys');
}

// util
function clone(o) {
  var _out, v, _key;
  _out = Array.isArray(o) ? [] : {};
  for (_key in o) {
    v = o[_key];
    _out[_key] = (typeof v === "object") ? copy(v) : v;
  }
  return _out;
}

function compare(a,b) {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

function compareRev(a,b) {
	if (a > b) return -1;
	if (a < b) return 1;
	return 0;
}

function an(card) {
	if (['A', 'E', 'I', 'O', 'U'].indexOf(card.name[0]) == -1)
		return 'a ' + card.name;
	return 'an ' + card.name;
}

// debug
function dc(cards) {
	return '[' + cards.join(',') + ']';
}

function log(msg) {
	$('#log').append($('<div/>').text(msg));
	$('#log').scrollTop(1E10)
	d(msg);
}

