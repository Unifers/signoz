package types

import (
	"reflect"
	"testing"
)

func TestIsValidProjectID(t *testing.T) {
	tests := []struct {
		name string
		id   string
		want bool
	}{
		{"empty", "", false},
		{"simple slug", "frontend-app", true},
		{"digits", "v2", true},
		{"only dashes", "a-b-c", true},
		{"uppercase rejected", "FrontEnd", false},
		{"underscore rejected", "a_b", false},
		{"space rejected", "a b", false},
		{"too long", string(make([]byte, 51)), false},
		{"slash rejected", "a/b", false},
		{"single char", "a", true},
		{"all digits", "123", true},
		{"all dashes", "---", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsValidProjectID(tt.id); got != tt.want {
				t.Errorf("IsValidProjectID(%q) = %v, want %v", tt.id, got, tt.want)
			}
		})
	}
}

func TestIsValidProjectLogType(t *testing.T) {
	for _, lt := range ProjectLogTypes {
		if !IsValidProjectLogType(lt) {
			t.Errorf("IsValidProjectLogType(%q) = false, want true", lt)
		}
	}
	if IsValidProjectLogType("not-a-real-type") {
		t.Error("expected unknown log type to be rejected")
	}
}

func TestLogTypesJSONRoundTrip(t *testing.T) {
	tests := [][]string{
		nil,
		{},
		{"application"},
		{"application", "system"},
		{"application", "system", "audit", "access"},
	}
	for _, in := range tests {
		enc := LogTypesJSONEncode(in)
		out, err := LogTypesJSONDecode(enc)
		if err != nil {
			t.Errorf("decode failed for %v: %v (encoded %q)", in, err, enc)
			continue
		}
		// Decode returns []string{} for empty; normalize both sides to that.
		want := out
		if want == nil {
			want = []string{}
		}
		got := in
		if got == nil {
			got = []string{}
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("round-trip mismatch: in=%v encoded=%q out=%v", got, enc, want)
		}
	}
}

func TestLogTypesJSONEncodeHandlesSpecialChars(t *testing.T) {
	// Although project log types are restricted to a hard-coded allowlist,
	// the encoder must not produce invalid JSON for any string input.
	cases := []string{`with"quote`, `with\back`, "with\nnewline"}
	for _, c := range cases {
		enc := LogTypesJSONEncode([]string{c})
		out, err := LogTypesJSONDecode(enc)
		if err != nil {
			t.Errorf("decode failed for %q: %v (encoded %q)", c, err, enc)
			continue
		}
		if len(out) != 1 || out[0] != c {
			t.Errorf("round-trip mismatch: in=%q encoded=%q out=%v", c, enc, out)
		}
	}
}

func TestPostableProjectValidate(t *testing.T) {
	tests := []struct {
		name    string
		p       PostableProject
		wantErr bool
	}{
		{"valid", PostableProject{Name: "frontend-app", LogTypes: []string{"application"}}, false},
		{"empty name", PostableProject{Name: "", LogTypes: []string{"application"}}, true},
		{"bad name", PostableProject{Name: "With Spaces", LogTypes: []string{"application"}}, true},
		{"no log types", PostableProject{Name: "frontend-app", LogTypes: nil}, true},
		{"bad log type", PostableProject{Name: "frontend-app", LogTypes: []string{"not-a-type"}}, true},
		{"multiple valid", PostableProject{Name: "a", LogTypes: []string{"system", "audit"}}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.p.Validate()
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate() err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
