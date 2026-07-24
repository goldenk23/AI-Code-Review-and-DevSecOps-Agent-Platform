package api

import "testing"

// TestGradeForCounts checks the security-grade rubric.
func TestGradeForCounts(t *testing.T) {
	cases := []struct {
		crit, high, med int
		want            string
	}{
		{0, 0, 0, "A"}, // clean
		{0, 0, 1, "B"}, // medium only -> B
		{0, 1, 0, "C"}, // high -> C (worse than medium)
		{1, 0, 0, "C"}, // critical -> C
	}
	for _, c := range cases {
		got := gradeForCounts(c.crit, c.high, c.med)
		if got != c.want {
			t.Errorf("gradeForCounts(%d,%d,%d) = %q, want %q",
				c.crit, c.high, c.med, got, c.want)
		}
	}
}

// TestClamp checks the settings-bounds helper.
func TestClamp(t *testing.T) {
	if clamp(-5, 1, 3) != 1 {
		t.Error("below min should clamp to min")
	}
	if clamp(9, 1, 3) != 3 {
		t.Error("above max should clamp to max")
	}
	if clamp(2, 1, 3) != 2 {
		t.Error("in-range should stay")
	}

}
