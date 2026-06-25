package types

import (
	"context"
	"strings"
	"time"

	"github.com/SigNoz/signoz/pkg/errors"
	"github.com/SigNoz/signoz/pkg/valuer"
	"github.com/uptrace/bun"
)

var (
	ErrProjectAlreadyExists = errors.MustNewCode("project_already_exists")
	ErrProjectNotFound      = errors.MustNewCode("project_not_found")
	ErrInvalidProjectID     = errors.MustNewCode("invalid_project_id")
	ErrInvalidLogType       = errors.MustNewCode("invalid_log_type")
)

// ProjectLogTypes is the hard-coded list of log types a project can advertise.
// The set is intentionally small and stable; it is mirrored on the frontend.
// Adding a new entry here is a non-breaking change.
var ProjectLogTypes = []string{
	"application",
	"system",
	"audit",
	"access",
}

// IsValidProjectLogType returns true if logType is in the hard-coded allowlist.
func IsValidProjectLogType(logType string) bool {
	for _, t := range ProjectLogTypes {
		if t == logType {
			return true
		}
	}
	return false
}

// IsValidProjectID returns true if id conforms to the project slug format
// (lowercase alphanumeric + dashes, 1-50 chars). The same regex is used
// for TypeProject selectors, so keeping them in sync avoids surprises.
func IsValidProjectID(id string) bool {
	if len(id) == 0 || len(id) > 50 {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9':
		case r == '-':
		default:
			return false
		}
	}
	return true
}

// Project represents a top-level boundary for log sources. A user can be
// granted per-(project, logType) read access via FGA tuples.
type Project struct {
	bun.BaseModel `bun:"table:project"`
	TimeAuditable
	Identifiable
	Name        string      `bun:"name,type:text,notnull" json:"name"`
	Description string      `bun:"description,type:text,nullzero" json:"description"`
	OrgID       valuer.UUID `bun:"org_id,type:text,notnull" json:"orgId"`
	// LogTypes is a JSON-encoded text column. It's stored as a string in the
	// DB for cross-dialect (sqlite + postgres) compatibility and exposed as
	// a []string on the API. The store is responsible for marshalling /
	// unmarshalling the JSON via LogTypesJSONEncode / LogTypesJSONDecode.
	LogTypes  []string    `bun:"-" json:"logTypes"`
	LogTypesJ string      `bun:"log_types,type:text,notnull" json:"-"`
	CreatedBy valuer.UUID `bun:"created_by,type:text,nullzero" json:"createdBy"`
}

// LogTypesJSONEncode serializes logTypes to a compact JSON string for storage.
// Inputs are assumed to be ASCII (project log types are a hard-coded allowlist);
// control characters are escaped for round-trip safety.
func LogTypesJSONEncode(logTypes []string) string {
	if len(logTypes) == 0 {
		return "[]"
	}
	// Manual JSON encoding keeps the dependency footprint small and avoids
	// reflection. The format is identical to json.Marshal on []string.
	var b strings.Builder
	b.Grow(64)
	b.WriteByte('[')
	for i, t := range logTypes {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('"')
		for j := 0; j < len(t); j++ {
			c := t[j]
			switch c {
			case '"', '\\':
				b.WriteByte('\\')
				b.WriteByte(c)
			case '\n':
				b.WriteString(`\n`)
			case '\r':
				b.WriteString(`\r`)
			case '\t':
				b.WriteString(`\t`)
			default:
				b.WriteByte(c)
			}
		}
		b.WriteByte('"')
	}
	b.WriteByte(']')
	return b.String()
}

// LogTypesJSONDecode is the inverse of LogTypesJSONEncode. It is intentionally
// minimal (assumes well-formed input produced by the encoder) and used only
// for round-tripping values the project store just wrote.
func LogTypesJSONDecode(s string) ([]string, error) {
	if s == "" {
		return []string{}, nil
	}
	if s[0] != '[' || s[len(s)-1] != ']' {
		return nil, errors.Newf(errors.TypeInvalidInput, ErrInvalidLogType, "log_types JSON is malformed: %q", s)
	}
	body := s[1 : len(s)-1]
	if body == "" {
		return []string{}, nil
	}
	out := make([]string, 0, 4)
	var i int
	for i < len(body) {
		if body[i] != '"' {
			return nil, errors.Newf(errors.TypeInvalidInput, ErrInvalidLogType, "expected '\"' at offset %d in %q", i, body)
		}
		i++
		var b strings.Builder
		for i < len(body) {
			r := body[i]
			if r == '\\' && i+1 < len(body) {
				// Handle the simple escape sequences the encoder can produce.
				switch body[i+1] {
				case 'n':
					b.WriteByte('\n')
				case 'r':
					b.WriteByte('\r')
				case 't':
					b.WriteByte('\t')
				case '"', '\\':
					b.WriteByte(body[i+1])
				default:
					// Unknown escape: pass through (forward-compat).
					b.WriteByte(body[i+1])
				}
				i += 2
				continue
			}
			if r == '"' {
				i++
				break
			}
			b.WriteByte(r)
			i++
		}
		out = append(out, b.String())
		if i < len(body) && body[i] == ',' {
			i++
		}
	}
	return out, nil
}

// NewProject builds a Project. LogTypes are JSON-encoded into LogTypesJ.
func NewProject(id, orgID, createdBy valuer.UUID, name, description string, logTypes []string) *Project {
	return &Project{
		Identifiable: Identifiable{ID: id},
		TimeAuditable: TimeAuditable{
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		},
		Name:        name,
		Description: description,
		OrgID:       orgID,
		LogTypes:    logTypes,
		LogTypesJ:   LogTypesJSONEncode(logTypes),
		CreatedBy:   createdBy,
	}
}

// PostableProject is the request body for creating a Project.
type PostableProject struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	LogTypes    []string `json:"logTypes"`
}

// Validate ensures the project body is well-formed.
func (p *PostableProject) Validate() error {
	if !IsValidProjectID(p.Name) {
		return errors.Newf(errors.TypeInvalidInput, ErrInvalidProjectID, "project name %q is not a valid project id (use lowercase letters, digits, dashes; max 50 chars)", p.Name)
	}
	if len(p.LogTypes) == 0 {
		return errors.Newf(errors.TypeInvalidInput, ErrInvalidLogType, "at least one log type is required")
	}
	for _, lt := range p.LogTypes {
		if !IsValidProjectLogType(lt) {
			return errors.Newf(errors.TypeInvalidInput, ErrInvalidLogType, "log type %q is not in the allowed list", lt)
		}
	}
	return nil
}

// UpdatableProject is the request body for updating a Project.
type UpdatableProject struct {
	Description *string  `json:"description"`
	LogTypes    []string `json:"logTypes"`
}

// Validate ensures the update body is well-formed.
func (p *UpdatableProject) Validate() error {
	if p.LogTypes == nil {
		return nil
	}
	if len(p.LogTypes) == 0 {
		return errors.Newf(errors.TypeInvalidInput, ErrInvalidLogType, "at least one log type is required")
	}
	for _, lt := range p.LogTypes {
		if !IsValidProjectLogType(lt) {
			return errors.Newf(errors.TypeInvalidInput, ErrInvalidLogType, "log type %q is not in the allowed list", lt)
		}
	}
	return nil
}

// ProjectStore is the persistence interface for Project.
type ProjectStore interface {
	Create(context.Context, *Project) error
	Get(context.Context, valuer.UUID, string) (*Project, error)
	List(context.Context, valuer.UUID) ([]*Project, error)
	Update(context.Context, *Project) error
	Delete(context.Context, valuer.UUID, string) error
}

// PostableProjectMember is the request body for granting a user access to
// a single (project, signal, logType) tuple.
type PostableProjectMember struct {
	UserID  string `json:"userId"`
	LogType string `json:"logType"`
	Signal  string `json:"signal"`
}

// Validate ensures the request body is well-formed. The three fields must
// form a valid grantable triple: a UUID user, one of the hard-coded log
// types, and one of the three telemetry signals.
func (p *PostableProjectMember) Validate() error {
	if p.UserID == "" {
		return errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "userId is required")
	}
	if _, err := valuer.NewUUID(p.UserID); err != nil {
		return errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "invalid userId %q", p.UserID)
	}
	if !IsValidProjectLogType(p.LogType) {
		return errors.Newf(errors.TypeInvalidInput, ErrInvalidLogType, "invalid log type %q", p.LogType)
	}
	if p.Signal != "logs" && p.Signal != "traces" && p.Signal != "metrics" {
		return errors.Newf(errors.TypeInvalidInput, errors.CodeInvalidInput, "invalid signal %q (must be logs, traces, or metrics)", p.Signal)
	}
	return nil
}

// ProjectMemberResponse is the response shape for listing members with
// access to a project. The LogType and Signal fields echo the grant
// dimensions so the binding UI can render a denormalized grid.
type ProjectMemberResponse struct {
	UserID      string `json:"userId"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	LogType     string `json:"logType"`
	Signal      string `json:"signal"`
}
