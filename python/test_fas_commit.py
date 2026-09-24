from fas_commit_test import square

def test_square_positive():
    assert square(2) == 4

def test_square_larger():
    assert square(5) == 25

def test_square_negative():
    assert square(-3) == 9