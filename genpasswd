import random
import string

def generate_password(length=10):
    # Define character sets
    lowercase_letters = string.ascii_lowercase
    uppercase_letters = string.ascii_uppercase
    digits = string.digits
    special_characters = string.punctuation

   
    all_characters = lowercase_letters + uppercase_letters + digits + special_characters

    password = [
        random.choice(lowercase_letters),
        random.choice(uppercase_letters),
        random.choice(digits),
        random.choice(special_characters)
    ]

    # Fill the rest of the password with random characters
    for _ in range(length - 6):
        password.append(random.choice(all_characters))

    random.shuffle(password)

   
    return ''.join(password)

# Example: Generate a password of length 16
password = generate_password(16)
print(password)
