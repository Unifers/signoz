package app

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetHostMetrics(t *testing.T) {
	aH := &APIHandler{
		logger: slog.Default(),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/host-metrics", nil)
	w := httptest.NewRecorder()

	aH.getHostMetrics(w, req)

	resp := w.Result()
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	var result AdminHostMetricsResponse
	err := json.NewDecoder(resp.Body).Decode(&result)
	require.NoError(t, err)

	// Verify System Info
	assert.NotEmpty(t, result.System.OS)
	assert.NotEmpty(t, result.System.Hostname)

	// Verify CPU Info
	assert.GreaterOrEqual(t, result.CPU.CoresLogical, 1)

	// Verify Memory Info
	assert.Greater(t, result.Memory.TotalBytes, uint64(0))

	// Verify Disks Info
	assert.NotNil(t, result.Disks)
}
