import pytest
from fas_runner_test import subtract


def test_subtract_positive_result():
    assert subtract(5, 3) == 2


def test_subtract_negative_result():
    assert subtract(3, 5) == -2


def test_subtract_zero():
    assert subtract(0, 0) == 0
