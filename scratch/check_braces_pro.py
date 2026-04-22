import sys

def check_braces(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
    
    stack = []
    lines = content.splitlines()
    
    for line_num, line in enumerate(lines, 1):
        for char in line:
            if char == '{':
                stack.append((line_num, line))
            elif char == '}':
                if not stack:
                    print(f"Extra closing brace at line {line_num}: {line.strip()}")
                    return False
                stack.pop()
    
    if stack:
        for ln, l in stack:
            print(f"Unclosed opening brace at line {ln}: {l.strip()}")
        return False
    
    print("Braces are balanced.")
    return True

if __name__ == "__main__":
    check_braces("css/posts.css")
