package thirdpartyapitypes

import (
	"github.com/SigNoz/signoz/pkg/errors"
	qbtypes "github.com/SigNoz/signoz/pkg/types/querybuildertypes/querybuildertypesv5"
)

type RuleConfig struct {
	ErrorCodes       string  `json:"errorCodes"`
	WarningCodes     string  `json:"warningCodes"`
	SuccessErrorRate float64 `json:"successErrorRate"`
	WarningErrorRate float64 `json:"warningErrorRate"`
}

type ThirdPartyApiRequest struct {
	Start      uint64               `json:"start"`
	End        uint64               `json:"end"`
	ShowIp     bool                 `json:"show_ip,omitempty"`
	GroupByUrl bool                 `json:"group_by_url,omitempty"`
	Domain     string               `json:"domain,omitempty"`
	Endpoint   string               `json:"endpoint,omitempty"`
	Filter     *qbtypes.Filter      `json:"filter,omitempty"`
	GroupBy    []qbtypes.GroupByKey `json:"groupBy,omitempty"`
	GlobalRule RuleConfig           `json:"globalRule,omitempty"`
	ApiRules   map[string]RuleConfig `json:"apiRules,omitempty"`
}

// Validate validates the ThirdPartyApiRequest.
func (req *ThirdPartyApiRequest) Validate() error {
	if req.Start >= req.End {
		return errors.New(errors.TypeInvalidInput, errors.CodeInvalidInput, "start time must be before end time")
	}

	if req.Filter != nil && req.Filter.Expression == "" {
		return errors.New(errors.TypeInvalidInput, errors.CodeInvalidInput, "filter expression cannot be empty when filter is provided")
	}

	return nil
}
