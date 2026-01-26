#! /usr/bin/python
from pwn import *
import base64

context.update(
        arch="amd64",
        endian="little",
        log_level="error",
        os="linux",
)

to = 2
ru = lambda p,s: p.recvuntil(s, timeout=to)
rl = lambda p: p.recvline()
sla = lambda p,a,b: p.sendlineafter(a, b, timeout=to)
sl = lambda p,a: p.sendline(a)
up = lambda b: int.from_bytes(b, byteorder="little")

SERVICE = "chal.2025-us.ductf.net"
PORT = 30021

def start(binary):

    gs = '''
        set context-sections stack regs disasm
        set show-compact-regs on
        set resolve-heap-via-heuristic on
        set follow-fork-mode parent
        continue
    '''

    if args.GDB:
        return gdb.debug([binary,'--allow-natives-syntax'], gdbscript=gs)
    elif args.REMOTE:
        return remote(SERVICE,PORT)
    else:
        return process([binary, '--allow-natives-syntax'])

def create(p, size, value):
    ru(p,b"")
    sl(p,b"%i" % size)
    ru(p,b"")
    sl(value)

def edit(p, index, value):
    ru(p,b"")
    sl(p,"%i" % index)
    ru(p,b"")
    sl(p,value)

def delete(p, index):
    ru(p,b"")
    sl(p,"%i" % index)

def view(p, index):
    ru(p,b"")
    sl(p,"%i" % index)
    ru(p,b"")
    return rl(p)
    
def read_js(filename):
    r64 = False
    input = ''
    brackets = []
    last_is_comma = False
    with open(filename, 'r') as file:
        for line in file:
            if 'Read64' in line:
                r64=True
            comment = line.find('//')
            if comment != -1:
                if "EXIT" in line:
                    return input
                line = line[0:comment]
            line = line.strip()
            if len(line) == 0:
                continue
            for c in line:
                if c == '{':
                    brackets.append(1)
                elif c == '}':
                    if len(brackets) == 0:
                        error('Mismatched brackets in js file')
                        exit()
                    brackets.pop()
            #if r64:
            #    print(f'lic: {last_is_comma}')
            if line[-1] == ',':
                last_is_comma = True
            else:
                if line[-1] != ';' and line[-1] != '{' and line[-1] != ',' and not last_is_comma:
                    if (("for" in line or "if" in line) and line[-1] != ')') or ("for" not in line and "if" not in line):
                        line += ';'
                last_is_comma = False
            if len(brackets) > 0: # in function, compress to one line
                input += line
            else:
                input += line + '\n'
    return input

if __name__=="__main__":
    file = args.BIN
    p = start(file)
    if args.JS:
        js = read_js(args.JS)
        if args.REMOTE:
            js_bytes = js.encode('utf-8')
            encoded_bytes = base64.b64encode(js_bytes)
            encoded_str = encoded_bytes.decode('utf-8')
            p.sendline(b"%i" % len(encoded_str))
            sleep(1)
            p.sendline(encoded_str)
            p.interactive()
            exit()
        if args.SL:
            print(js)
            exit()
        sl(p, js);
        
    p.interactive()
