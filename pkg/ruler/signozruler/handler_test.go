package signozruler

import (
	"testing"

	"github.com/SigNoz/signoz/pkg/types/authtypes"
)

func TestVisibleToUser(t *testing.T) {
	tests := []struct {
		name     string
		services []string
		access   authtypes.UserAllowedProjects
		want     bool
	}{
		{
			name:     "unrestricted user sees everything",
			services: []string{"traky-api"},
			access:   authtypes.UserAllowedProjects{Unrestricted: true},
			want:     true,
		},
		{
			name:     "unrestricted user sees service-agnostic rules",
			services: nil,
			access:   authtypes.UserAllowedProjects{Unrestricted: true},
			want:     true,
		},
		{
			name:     "user with overlap sees rule",
			services: []string{"traky-api", "payments-api"},
			access:   authtypes.UserAllowedProjects{Allowed: map[string]bool{"traky-api": true}},
			want:     true,
		},
		{
			name:     "user without overlap cannot see rule",
			services: []string{"payments-api"},
			access:   authtypes.UserAllowedProjects{Allowed: map[string]bool{"traky-api": true}},
			want:     false,
		},
		{
			name:     "service-agnostic rule hidden from restricted user",
			services: nil,
			access:   authtypes.UserAllowedProjects{Allowed: map[string]bool{"traky-api": true}},
			want:     false,
		},
		{
			name:     "user with empty allow set sees nothing",
			services: []string{"traky-api"},
			access:   authtypes.UserAllowedProjects{Allowed: map[string]bool{}},
			want:     false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := visibleToUser(tc.services, tc.access)
			if got != tc.want {
				t.Fatalf("visibleToUser(%v, %+v) = %v, want %v", tc.services, tc.access, got, tc.want)
			}
		})
	}
}
