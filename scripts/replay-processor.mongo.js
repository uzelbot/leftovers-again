//


var getFirstMoves = function() {
  db.firstmoves.drop();

  db.events.aggregate([
    { $match: {type: 'move'} },
    { $sort: {turn: 1 } },
    { $group: {
          _id: { from: "$from", matchid: "$matchid", player: "$player" },
          firstMove: { $first: "$move" }
      } },
    { $group: {
      _id: { from: "$_id.from", move: "$firstMove" },
      count: {$sum: 1}
    } },
    { $out: "firstmoves" }
  ]);
}

var getBigrams = function() {
  // bigrams

  db.messybigrams.drop();

  var mapfn = function() {
    var key = {
      matchid: this.matchid,
      player: this.player,
      species: this.from
    };
    var value = {
      move: this.move,
      turn: this.turn
    };
    emit(key, value);
  };

  var reducefn = function(key, values) {
    var bigrams = [];
    // @TODO better sort this by turn for safety.
    for (var i = 1; i < values.length; i++) {
      // don't count swap-ins
      if( values[i].turn - values[i-1].turn > 2) continue;

      bigrams.push([values[i-1].move, values[i].move]);
    }
    return {
      _id: key.species,
      value: bigrams
    };
  };

  db.events.mapReduce(
    mapfn,
    reducefn,
    { query: {type: 'move'},
      sort: {matchid: 1, player: 1, turn: 1 },
      out: 'messybigrams'
    }
  );

  db.bigrams.drop();

  var bmapfn = function() {

    // species
    var key = this.value._id;
    if (key === undefined) return;
    var value = this.value.value;
    print('map:', key, value);

    emit(key, value);
  };

  var breducefn = function(key, values) {
    var merged = [].concat.apply([], values);
    print('merged:', merged);
    return {value: merged};
  };

  var finalizefn = function(key, reducedVal) {
    var bigramcounts = {};
    print('finalizing', key, reducedVal);
    if(reducedVal && reducedVal.length > 0)
    {
      print('looking at value:', reducedVal);
      reducedVal.forEach( function(bigram) {
        var bstr = bigram.toString();
        print('using bigram string ', bstr);
        print(bstr);

        if (bigramcounts[bigram]) {
          bigramcounts[bigram] = bigramcounts[bigram] + 1;
        } else {
          bigramcounts[bigram] = 1;
        }
      });
    }
    return bigramcounts;
  };

  db.messybigrams.mapReduce(
    bmapfn,
    breducefn,
    {
      out: 'bigrams',
      finalize: finalizefn
    }
  );
}

var getMatchupFirstMoves = function() {
  // great! now let's get matchup data.
  db.matchupfirstmoves.drop();

  db.events.aggregate([
    { $match: {type: 'move'} },
    { $sort: {turn: 1 } },
    { $group: {
          _id: { from: "$from",
            to: "$to",
            matchid: "$matchid",
            player: "$player" },
          firstMove: { $first: "$move" }
      } },
    { $group: {
      _id: { from: "$_id.from", to: "$_id.to", move: "$firstMove" },
      count: {$sum: 1}
    } },
    { $out: "matchupfirstmoves" }
  ]);

  db.matchupmoves.drop();

  db.events.aggregate([
    { $match: {type: 'move'} },
    { $group: {
        _id: { from: "$from",
          to: "$to",
          matchid: "$matchid",
          player: "$player" },
        count: {$sum: 1}
      } },
    { $out: "matchupmoves" }
  ]);
}

var getMatchupResults = function() {
  db.messymatchupresults.drop();

  // for the first map-reduce function, we're just trying to figure out what
  // happened on a given turn.
  var mmapfn = function() {
    var key = {
      matchid: this.matchid,
      turn: this.turn
    };
    var value = {
      type: this.type,
      move: this.move,
      from: this.from,
      to: this.to,
      player: this.player,
      killed: this.killed
    };

    if (this.matchid === 'randombattle-127900697') {
      print('LOOKING AT THIS BROKEN DATA...');
      print(this.matchid, this.turn, this.player);
    }
    emit(key, value);
  };



  // test for the above: should be a move from Klink then a move from Starly
  // whatWeCareAbout([
  // { "type" : "move", "player" : "p1", "turn" : 1, "from" : "Starly"},
  // { "type" : "switch", "player" : "p1", "turn" : 1, "from" : "Starly"},
  // { "type" : "move", "player" : "p2", "turn" : 1, "from" : "Klink"}
  // ]);

  var mreducefn = function(key, values) {
    var selfkey = key;
    var selfvalues = values;

    var whatWeCareAbout = function(events) {
      var movesFirst = function (a, b) {
        if (a.type > b.type) {
          return 1;
        }
        if (a.type < b.type) {
          return -1;
        }
        return 0;
      };

      var bySpecies = function (a, b) {
        if (a.from > b.from) {
          return 1;
        }
        if (a.from < b.from) {
          return -1;
        }
        return 0;
      };

      if(events.length < 2) return;

      var p1events = events.filter( function(event) {
        if(!event) {
          print('wtf no player!!');
          print(tojson(selfkey));
          print(tojson(selfvalues));
          exit;
        }
        return event.player === 'p1'
      }).sort(movesFirst);

      var p2events = events.filter( function(event) {
        if(!event) return false;
        return event.player === 'p2'
      }).sort(movesFirst);

      return [p1events[0], p2events[0]].sort(bySpecies);
    }

    if(values.length < 2) {
      return null;
    }

    if(values[0] === null || values[1] === null) {
      print('BAIL! value is null');
      print(tojson(key), tojson(values));
      return null;
    }

    // sort by the species doing the thing

    var actions = whatWeCareAbout(values);

    var what = {};

    if(actions.length === 2 && actions[0] && actions[1]) {
      if(actions[0].killed) {
        what.bkilled = 1;
      }
      if(actions[1].killed) {
        what.akilled = 1;
      }
      if(actions[0].type === 'switch' && !what.akilled) {
        what.aswitched = 1;
      }
      if(actions[1].type === 'switch' && !what.bkilled) {
        what.bswitched = 1;
      }
      return {
        matchup: actions[0].from + '::' + actions[1].from,
        results: what
      };
    }
    return null;

  };

  var mfinalizefn = function(key, val) {
    if(val === null) return null;
    if(val.matchup) return val;
    // only one thing happened...
   var bySpecies = function (a, b) {
      if (a.from > b.from) {
        return 1;
      }
      if (a.from < b.from) {
        return -1;
      }
      return 0;
    };
    var what = {};

    var species = [val.from, val.to].sort(bySpecies);
    if(species[0] === val.from && val.killed) {
      what.bkilled = 1;
    } else if (species[1] === val.from && val.killed) {
      what.akilled = 1;
    }
    return {
      matchup: species[0] + '::' + species[1],
      results: what
    };
  };

  db.events.mapReduce(
    mmapfn,
    mreducefn,
    // { query: {match: 'randombattle-98387915', type: {$in: ['switch', 'move']}},
    { query: {turn: {$gt: 0}, type: {$in: ['switch', 'move']}},
      sort: {matchid: 1, player: 1, turn: 1 },
      out: 'messymatchupresults',
      finalize: mfinalizefn
    }
  );

  db.matchupresults.drop();

  var smapfn = function() {
    emit(this.value.matchup, this.value.results);
  }
  var sreducefn = function(key, values) {
    var result = {
      akilled: 0,
      bkilled: 0,
      aswitched: 0,
      bswitched: 0
    };

    values.forEach( function(value) {
      if(value.akilled) result.akilled++;
      if(value.bkilled) result.bkilled++;
      if(value.aswitched) result.aswitched++;
      if(value.bswitched) result.bswitched++;
    });
    return result;
  }

  db.messymatchupresults.mapReduce(
    smapfn,
    sreducefn,
    {
      query: {"value.results": {$exists: true}, "value.matchup": {$exists: true} },
      out: 'matchupresults'
    }
  );

}


getMatchupResults();