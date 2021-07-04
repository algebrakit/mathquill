// LaTeX environments
// Environments are delimited by an opening \begin{} and a closing
// \end{}. Everything inside those tags will be formatted in a
// special manner depending on the environment type.
var Environments = {};

LatexCmds.begin = P(MathCommand, function(_, super_) {
  _.parser = function() {
    var string = Parser.string;
    var regex = Parser.regex;
    return string('{')
      .then(regex(/^[a-z]+/i))
      .skip(string('}'))
      .then(function (env) {
          return (Environments[env] ?
            Environments[env]().parser() :
            Parser.fail('unknown environment type: '+env)
          ).skip(string('\\end{'+env+'}'));
      })
    ;
  };
});

var Environment = P(MathCommand, function(_, super_) {
  _.template = [['\\begin{', '}'], ['\\end{', '}']];
  _.wrappers = function () {
    return [
      _.template[0].join(this.environment),
      _.template[1].join(this.environment)
    ];
  };
});

var Matrix =
Environments.matrix = P(Environment, function(_, super_) {

  var delimiters = {
    column: '&',
    row: '\\\\'
  };
  _.parentheses = {
    left: null,
    right: null
  };
  _.environment = 'matrix';

  _.reflow = function() {
    var blockjQ = this.jQ.children('table');

    var height = blockjQ.outerHeight()/+blockjQ.css('fontSize').slice(0,-2);

    var parens = this.jQ.children('.mq-paren');
    if (parens.length) {
      scale(parens, min(1 + .2*(height - 1), 1.2), 1.05*height);
    }
  };
  _.latex = function() {
    var latex = '';
    var row;

    this.eachChild(function (cell) {
      if (typeof row !== 'undefined') {
        latex += (row !== cell.row) ?
          delimiters.row :
          delimiters.column;
      }
      row = cell.row;
      latex += cell.latex();
    });

    return this.wrappers().join(latex);
  };
  _.html = function() {
    var cells = [], trs = '', i=0, row;

    function parenHtml(paren) {
      return (paren) ?
          '<span class="mq-scaled mq-paren">'
        +   paren
        + '</span>' : '';
    }

    // Build <tr><td>.. structure from cells
    this.eachChild(function (cell) {
      if (row !== cell.row) {
        row = cell.row;
        trs += '<tr>$tds</tr>';
        cells[row] = [];
      }
      cells[row].push('<td>&'+(i++)+'</td>');
    });

    this.htmlTemplate =
        '<span class="mq-matrix mq-non-leaf">'
      +   parenHtml(this.parentheses.left)
      +   '<table class="mq-non-leaf">'
      +     trs.replace(/\$tds/g, function () {
              return cells.shift().join('');
            })
      +   '</table>'
      +   parenHtml(this.parentheses.right)
      + '</span>'
    ;

    return super_.html.call(this);
  };
  // Create default 4-cell matrix
  _.createBlocks = function() {
    this.blocks = [
      MatrixCell(0, this),
      MatrixCell(0, this),
      MatrixCell(1, this),
      MatrixCell(1, this)
    ];
  };
  _.parser = function() {
    var self = this;
    var optWhitespace = Parser.optWhitespace;
    var string = Parser.string;

    return optWhitespace
    .then(string(delimiters.column)
      .or(string(delimiters.row))
      .or(latexMathParser.block))
    .many()
    .skip(optWhitespace)
    .then(function(items) {
      var blocks = [];
      var row = 0;
      self.blocks = [];

      function addCell() {
        self.blocks.push(MatrixCell(row, self, blocks));
        blocks = [];
      }

      for (var i=0; i<items.length; i+=1) {
        if (items[i] instanceof MathBlock) {
          blocks.push(items[i]);
        } else {
          addCell();
          if (items[i] === delimiters.row) row+=1;
        }
      }
      addCell();
      self.autocorrect();
      return Parser.succeed(self);
    });
  };
  // Relink all the cells after parsing
  _.finalizeTree = function() {
    var table = this.jQ.find('table');
    table.toggleClass('mq-rows-1', table.find('tr').length === 1);
    this.relink();
  };
  // Enter the matrix at the top or bottom row if updown is configured.
  _.getEntryPoint = function(dir, cursor, updown) {
    if (updown === 'up') {
      if (dir === L) {
        return this.blocks[this.rowSize - 1];
      } else {
        return this.blocks[0];
      }
    } else { // updown === 'down'
      if (dir === L) {
        return this.blocks[this.blocks.length - 1];
      } else {
        return this.blocks[this.blocks.length - this.rowSize];
      }
    }
  };
  // Exit the matrix at the first and last columns if updown is configured.
  _.atExitPoint = function(dir, cursor) {
      // Which block are we in?
      var i = this.blocks.indexOf(cursor.parent);
      if (dir === L) {
        // If we're on the left edge and moving left, we should exit.
        return i % this.rowSize === 0;
      } else {
        // If we're on the right edge and moving right, we should exit.
        return (i + 1) % this.rowSize === 0;
      }
  };
  _.moveTowards = function(dir, cursor, updown) {
    var entryPoint = updown && this.getEntryPoint(dir, cursor, updown);
    cursor.insAtDirEnd(-dir, entryPoint || this.ends[-dir]);
  };

  // Set up directional pointers between cells
  _.relink = function() {
    var blocks = this.blocks;
    var rows = [];
    var row, column, cell;

    // The row size will be used by other functions down the track.
    // Begin by assuming we're a one-row matrix, and we'll overwrite this if we find another row.
    this.rowSize = blocks.length;

    // Use a for loop rather than eachChild
    // as we're still making sure children()
    // is set up properly
    for (var i=0; i<blocks.length; i+=1) {
      cell = blocks[i];
      if (row !== cell.row) {
        if (cell.row === 1) {
          // We've just finished iterating the first row.
          this.rowSize = column;
        }
        row = cell.row;
        rows[row] = [];
        column = 0;
      }
      rows[row][column] = cell;

      // Set up horizontal linkage
      cell[R] = blocks[i+1];
      cell[L] = blocks[i-1];

      // Set up vertical linkage
      if (rows[row-1] && rows[row-1][column]) {
        cell.upOutOf = rows[row-1][column];
        rows[row-1][column].downOutOf = cell;
      }

      column+=1;
    }

    // set start and end blocks of matrix
    this.ends[L] = blocks[0];
    this.ends[R] = blocks[blocks.length-1];
  };
  // Ensure consistent row lengths
  _.autocorrect = function(rows) {
    var lengths = [], rows = [];
    var blocks = this.blocks;
    var maxLength, shortfall, position, row, i;

    for (i=0; i<blocks.length; i+=1) {
      row = blocks[i].row;
      rows[row] = rows[row] || [];
      rows[row].push(blocks[i]);
      lengths[row] = rows[row].length;
    }

    maxLength = Math.max.apply(null, lengths);
    if (maxLength !== Math.min.apply(null, lengths)) {
      // Pad shorter rows to correct length
      for (i=0; i<rows.length; i+=1) {
        shortfall = maxLength - rows[i].length;
        while (shortfall) {
          position = maxLength*i + rows[i].length;
          blocks.splice(position, 0, MatrixCell(i, this));
          shortfall-=1;
        }
      }
      this.relink();
    }
  };
  // Deleting a cell will also delete the current row and
  // column if they are empty, and relink the matrix.
  _.deleteCell = function(currentCell) {
    var rows = [], columns = [], myRow = [], myColumn = [];
    var blocks = this.blocks, row, column;

    // Create arrays for cells in the current row / column
    this.eachChild(function (cell) {
      if (row !== cell.row) {
        row = cell.row;
        rows[row] = [];
        column = 0;
      }
      columns[column] = columns[column] || [];
      columns[column].push(cell);
      rows[row].push(cell);

      if (cell === currentCell) {
        myRow = rows[row];
        myColumn = columns[column];
      }

      column+=1;
    });

    function isEmpty(cells) {
      var empties = [];
      for (var i=0; i<cells.length; i+=1) {
        if (cells[i].isEmpty()) empties.push(cells[i]);
      }
      return empties.length === cells.length;
    }

    function remove(cells) {
      for (var i=0; i<cells.length; i+=1) {
        if (blocks.indexOf(cells[i]) > -1) {
          cells[i].remove();
          blocks.splice(blocks.indexOf(cells[i]), 1);
        }
      }
    }

    if (isEmpty(myRow) && myColumn.length > 1) {
      row = rows.indexOf(myRow);
      // Decrease all following row numbers
      this.eachChild(function (cell) {
        if (cell.row > row) cell.row-=1;
      });
      // Dispose of cells and remove <tr>
      remove(myRow);
      this.jQ.find('tr').eq(row).remove();
    }
    if (isEmpty(myColumn) && myRow.length > 1) {
      remove(myColumn);
    }
    this.finalizeTree();
  };
  _.addRow = function(afterCell) {
    var previous = [], newCells = [], next = [];
    var newRow = jQuery('<tr></tr>'), row = afterCell.row;
    var columns = 0, block, column;

    this.eachChild(function (cell) {
      // Cache previous rows
      if (cell.row <= row) {
        previous.push(cell);
      }
      // Work out how many columns
      if (cell.row === row) {
        if (cell === afterCell) column = columns;
        columns+=1;
      }
      // Cache cells after new row
      if (cell.row > row) {
        cell.row+=1;
        next.push(cell);
      }
    });

    // Add new cells, one for each column
    for (var i=0; i<columns; i+=1) {
      block = MatrixCell(row+1);
      block.parent = this;
      newCells.push(block);

      // Create cell <td>s and add to new row
      block.jQ = jQuery('<td class="mq-empty">')
        .attr(mqBlockId, block.id)
        .appendTo(newRow);
    }

    // Insert the new row
    this.jQ.find('tr').eq(row).after(newRow);
    this.blocks = previous.concat(newCells, next);
    return newCells[column];
  };
  _.addColumn = function(afterCell) {
    var rows = [], newCells = [];
    var column, block;

    // Build rows array and find new column index
    this.eachChild(function (cell) {
      rows[cell.row] = rows[cell.row] || [];
      rows[cell.row].push(cell);
      if (cell === afterCell) column = rows[cell.row].length;
    });

    // Add new cells, one for each row
    for (var i=0; i<rows.length; i+=1) {
      block = MatrixCell(i);
      block.parent = this;
      newCells.push(block);
      rows[i].splice(column, 0, block);

      block.jQ = jQuery('<td class="mq-empty">')
        .attr(mqBlockId, block.id);
    }

    // Add cell <td> elements in correct positions
    this.jQ.find('tr').each(function (i) {
      jQuery(this).find('td').eq(column-1).after(rows[i][column].jQ);
    });

    // Flatten the rows array-of-arrays
    this.blocks = [].concat.apply([], rows);
    return newCells[afterCell.row];
  };
  _.insert = function(method, afterCell) {
    var cellToFocus = this[method](afterCell);
    this.cursor = this.cursor || this.parent.cursor;
    this.finalizeTree();
    this.bubble('reflow').cursor.insAtRightEnd(cellToFocus);
  };
  _.backspace = function(cell, dir, cursor, finalDeleteCallback) {
    var dirwards = cell[dir];
    if (cell.isEmpty()) {
      this.deleteCell(cell);
      while (dirwards &&
        dirwards[dir] &&
        this.blocks.indexOf(dirwards) === -1) {
          dirwards = dirwards[dir];
      }
      if (dirwards) {
        cursor.insAtDirEnd(-dir, dirwards);
      }
      if (this.blocks.length === 1 && this.blocks[0].isEmpty()) {
        finalDeleteCallback();
        this.finalizeTree();
      }
      this.bubble('edited');
    }
  };
});

Environments.cases = P(Matrix, function(_, super_) {
  _.environment = 'cases';
  _.parentheses = {
    left: '\{',
    right: ''
  };
});


// LatexCmds.pmatrix =  // Debug purposes
Environments.pmatrix = P(Matrix, function(_, super_) {
  _.environment = 'pmatrix';
  _.parentheses = {
    left: '(',
    right: ')'
  };
});

Environments.bmatrix = P(Matrix, function(_, super_) {
  _.environment = 'bmatrix';
  _.parentheses = {
    left: '[',
    right: ']'
  };
});

Environments.Bmatrix = P(Matrix, function(_, super_) {
  _.environment = 'Bmatrix';
  _.parentheses = {
    left: '{',
    right: '}'
  };
});

Environments.vmatrix = P(Matrix, function(_, super_) {
  _.environment = 'vmatrix';
  _.parentheses = {
    left: '|',
    right: '|'
  };
});

Environments.Vmatrix = P(Matrix, function(_, super_) {
  _.environment = 'Vmatrix';
  _.parentheses = {
    left: '&#8214;',
    right: '&#8214;'
  };
});

// Replacement for mathblocks inside matrix cells
// Adds matrix-specific keyboard commands
var MatrixCell = P(MathBlock, function(_, super_) {
  _.init = function(row, parent, replaces) {
    super_.init.call(this);
    this.row = row;
    if (parent) {
      this.adopt(parent, parent.ends[R], 0);
    }
    if (replaces) {
      for (var i=0; i<replaces.length; i++) {
        replaces[i].children().adopt(this, this.ends[R], 0);
      }
    }
  };
  _.keystroke = function(key, e, ctrlr) {
    switch (key) {
    case 'Shift-Spacebar':
      e.preventDefault();
      return this.parent.insert('addColumn', this);
      break;
    case 'Shift-Enter':
    return this.parent.insert('addRow', this);
      break;
    }
    return super_.keystroke.apply(this, arguments);
  };
  _.deleteOutOf = function(dir, cursor) {
    var self = this, args = arguments;
    this.parent.backspace(this, dir, cursor, function () {
      // called when last cell gets deleted
      return super_.deleteOutOf.apply(self, args);
    });
  };
  _.moveOutOf = function(dir, cursor, updown) {
    var atExitPoint = updown && this.parent.atExitPoint(dir, cursor);
    // Step out of the matrix if we've moved past an edge column
    if (!atExitPoint && this[dir]) cursor.insAtDirEnd(-dir, this[dir]);
    else cursor.insDirOf(dir, this.parent);
  };
});
