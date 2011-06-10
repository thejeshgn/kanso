/* global $: false */

var core = require('kanso/core'),
    db = require('kanso/db'),
    loader = require('kanso/loader'),
    utils = require('kanso/utils'),
    widgets = require('kanso/widgets'),
    querystring = require('kanso/querystring'),
    _ = require('kanso/underscore')._;


/**
 * Convert an object containing several [ module, callback ] or
 * { module: x, callback: y } items in to an object containing
 * several native javascript functions, by using require.
 *
 * @param actions An object, containing items describing a
 *          function that can be obtained via require().
 */
exports.parseActionCallbacks = function(actions) {
    var rv = {};
    for (var k in actions) {
        var module, callback, action = actions[k];
        if (action instanceof Array) {
            module = action[0];
            callback = action[1];
        } else if (action instanceof Object) {
            module = action.module;
            callback = action.callback;
        } else if (action instanceof Function) {
            rv[k] = action;
            continue;
        } else {
            throw new Error(
                'Action `' + k + '` is of type `' + typeof(action) + '`, ' +
                    "which this function doesn't know how to interpret"
            );
        }
        /* Resolve function description to actual function */
        rv[k] = require(module)[callback];
    }
    return rv;
}

/**
 * Bind all events necessary to manage add, edit, and delete operations
 * on embed and embedList fields. If you wish to override the default
 * actions, you can pass an actions option (i.e. an object of the form
 * { add: x, edit: y, del: z }), where x, y, and z are items as described
 * in parseActionCallbacks.
 */
exports.bind = function (actions) {
    var action_callbacks = exports.parseActionCallbacks(
        typeof(actions) === 'object' ? actions : {}
    );
    $('form').each(function () {
        $('.embedded, .embeddedlist', this).each(function () {
            exports.initRow(this, action_callbacks);
            $('tr', this).each(function () {
                exports.updateRow(this, action_callbacks);
            });
        });
    });
};

/**
 * initRow
 */
exports.initRow = function (row, action_callbacks) {
    var action_callbacks = (_.defaults(action_callbacks || {}, {
        add: exports.showModal, create: exports.defaultWidgetFactory
    }));
    return exports.createAddBtn(
        row, action_callbacks.add, action_callbacks.create
    );
};

/**
 * updateRow
 */
exports.updateRow = function (row, action_callbacks) {
    var val = exports.getRowValue(row);
    var field_td = $(row).parent().parent().parent();

    var action_callbacks = (_.defaults(action_callbacks || {}, {
        edit: exports.showModal
    }));

    if (val) {
        exports.addRowControls(
            row, action_callbacks.edit, action_callbacks.del
        );
    }
    else {
        $(row).remove();
    }
    var row_count = $('tr', field_td).length;
    if (field_td.parent().hasClass('embedded')) {
        if (!row_count) {
            $('.addbtn', field_td).show();
        }
        else {
            $('.addbtn', field_td).hide();
        }
    }
    exports.renumberRows(field_td);
};

/**
 * getRowValue
 */
exports.getRowValue = function (row) {
    var str = $('input:hidden', row).val();
    if (!str) {
        return;
    }
    return JSON.parse(str);
};

/**
 * addRowControls
 */
exports.addRowControls = function (row, edit_callback, delete_callback) {
    if (exports.getRowValue(row)) {
        var container = $('td.actions', row).html('');
        var editbtn = $(
            '<input type="button" class="editbtn" value="Edit" />'
        );
        var delbtn  = $(
            '<input type="button" class="delbtn" value="Delete" />'
        );
        editbtn.click(exports.editbtnHandler(edit_callback));
        delbtn.click(exports.delbtnHandler(delete_callback));
        container.append(editbtn, delbtn);
    }
};

/**
 * createAddBtn
 */
exports.createAddBtn = function (field_row, add_callback, widget_factory) {

    var addbtn = $(
        '<input type="button" class="addbtn" value="Add" />'
    );

    addbtn.click(
        exports.addbtnHandler(add_callback, widget_factory)
    );

    $('.field .addbtn', field_row).remove();
    $('.field', field_row).append(addbtn);
};

/**
 * getModules
 */
exports.getModules = function (/*optional*/req, callback) {
    if (!callback) {
        /* Arity = 1: callback only */
        callback = req;
        req = core.currentRequest();
    }
    db.getDesignDoc(req.query.app, function (err, ddoc) {
        if (err) {
            throw err;
        }
        var settings = loader.appRequire(ddoc, 'kanso/settings');
        var app = loader.appRequire(ddoc, settings.load);
        var forms = loader.appRequire(ddoc, 'kanso/forms');
        callback(settings, app, forms);
    });
};

/**
 * showModal
 */
exports.showModal = function (div, field_td, row,
                              typename, val, rawval, widget_factory) {

    exports.getModules(function (settings, app, forms) {
        var type = app.types[typename];
        var form = new forms.Form(type, val);

        if (rawval) {
            form.validate(rawval);
        }

        div.html('<h2>' + (val ? 'Edit ': 'Add ') + typename + '</h2>');
        div.append('<form>' + form.toHTML() + '</form>');

        var action = (val ? 'Update': 'Add');
        var okbtn = $('<input type="button" value="' + action  + '" />"');
        okbtn.click(function () {
            var qs = $('form', div).serialize().replace(/\+/g, '%20');
            var rawval = querystring.parse(qs);
            form.validate(rawval);
            if (form.isValid()) {
                if (!val) {
                    row = exports.addRow(
                        field_td, widget_factory, val, rawval, type
                    );
                }
                var jsonval = JSON.stringify(form.values);
                $('input:hidden', row).val(jsonval);
                $('span.value', row).text(form.values._id);
                exports.updateRow(row);
                $.modal.close();
            }
            else {
                exports.showModal(div, field_td, row, typename, val, rawval);
            }
        });
        div.append(okbtn);
        div.submit(function (ev) {
            ev.preventDefault();
            okbtn.click();
            return false;
        });

        var cancelbtn = $(
            '<input type="button" value="Cancel" />'
        );
        cancelbtn.click(function () {
            $.modal.close();
        });
        div.append(cancelbtn);

        // generate ids when adding documents
        if (!val) {
            db.newUUID(100, function (err, uuid) {
                if (err) {
                    throw err;
                }
                $('input[name="_id"]', div).attr({
                    value: uuid
                });
            });
        }

        div.modal();
        utils.resizeModal(div);
    });
};

/**
 * renumberRows
 */
exports.renumberRows = function (field_td) {
    var field_row = field_td.parent();
    var name = $('table', field_td).attr('rel');
    if (field_row.hasClass('embeddedlist')) {
        $('tr', field_td).each(function (i) {
            $('input:hidden', this).attr({'name': name + '.' + i});
        });
    }
    else {
        $('input:hidden', field_td).attr({'name': name});
    }
};

/**
 * defaultWidgetFactory:
 */
exports.defaultWidgetFactory = function () {
    return widgets.defaultEmbedded();
};

/**
 * addRow
 */
exports.addRow = function (field_td, widget_factory, val, rawval) {

    /* FIXME:
        We need to discover the field name and field descriptor,
        so that it can be passed to the widget's rendering function. */

    var widget = widget_factory();
    var tr = $(
        '<tr>' +
            '<td>' +
                widget.toHTML('', val) +
            '</td>' +
            '<td class="actions"></td>' +
        '</tr>'
    );

    $('tbody', field_td).append(tr);
    return tr;
};

/**
 * getRowType
 */
exports.getRowType = function (row) {
    var field_td = row.parent().parent().parent();
    return field_td.attr('rel');
};

/**
 * addbtnHandler
 */
exports.addbtnHandler = function (add_callback, widget_factory) {
    return function (ev) {
        var field_td = $(this).parent();
        var typename = field_td.attr('rel');
        var div = $('<div/>');
        if (add_callback) {
            add_callback(
                div, field_td, null, typename, null, null, widget_factory
            );
        }
    };
};

/**
 * editbtnHandler
 */
exports.editbtnHandler = function (edit_callback) {
    return function (ev) {
        var row = $(this).parent().parent();
        var field_td = row.parent().parent().parent();
        var val = exports.getRowValue(row);
        var typename = exports.getRowType(row);
        var div = $('<div/>');
        if (edit_callback) {
            edit_callback(div, field_td, row, typename, val);
        }
    };
};

/**
 * delbtnHandler
 */
exports.delbtnHandler = function (delete_callback) {
    return function (ev) {
        var row = $(this).parent().parent();
        $('input:hidden', row).val('');
        $('span.value', row).html('');
        exports.updateRow(row);
        if (delete_callback) {
            delete_callback(row);
        }
    };
};